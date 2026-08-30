//! Win32 backend. Client coordinates are already top-left, and they are
//! reported unscaled: whatever `deno desktop` does with the requested size,
//! `GetClientRect` and `getSize()` agree (the webview backend keeps a 640x480
//! window 640x480 physical at 150%, the raw backend makes it 960x720 and says
//! so), so the content view's own pixels *are* its logical pixels here. Do not
//! divide by `GetDpiForWindow` — that would put `clientX` / `clientY` in a
//! different space from `getSize()` and from the drawing surface.
//!
//! Input is captured with a thread-local `WH_GETMESSAGE` hook on the thread
//! that owns the window, which mirrors the macOS local event monitor: the
//! window procedure is left untouched and messages still reach winit.
//!
//! That hook alone is not enough. A `deno desktop` window is a WebView2 host
//! (`LaufeyWebView2`), and the window actually under the cursor belongs to a
//! separate `msedgewebview2` process, so real wheel and key messages are queued
//! to *that* process and this thread never sees them. Raw input registered with
//! `RIDEV_INPUTSINK` fixes it: `WM_INPUT` is delivered to our own window no
//! matter who has focus, and the same hook picks it up. Legacy messages are
//! still read for hosts that do deliver them, so `push` drops an event the two
//! paths both reported.

use std::ffi::{c_void, CStr};
use std::mem::size_of;
use std::os::raw::c_char;
use std::ptr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use windows_sys::Win32::Devices::HumanInterfaceDevice::{
    HID_USAGE_GENERIC_KEYBOARD, HID_USAGE_GENERIC_MOUSE, HID_USAGE_PAGE_GENERIC,
};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    ClientToScreen, GetMonitorInfoW, MonitorFromWindow, ScreenToClient, MONITORINFO,
    MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::System::SystemServices::{
    MK_CONTROL, MK_LBUTTON, MK_MBUTTON, MK_RBUTTON, MK_SHIFT, MK_XBUTTON1, MK_XBUTTON2,
};
use windows_sys::Win32::System::Threading::GetCurrentProcessId;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, GetDoubleClickTime, GetKeyState, GetKeyboardLayout, GetKeyboardState,
    MapVirtualKeyW, ToUnicodeEx, MAPVK_VSC_TO_VK_EX, VK_CAPITAL, VK_CONTROL, VK_LBUTTON,
    VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_MBUTTON, VK_MENU, VK_RBUTTON, VK_RCONTROL,
    VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT, VK_XBUTTON1, VK_XBUTTON2,
};
use windows_sys::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RAWKEYBOARD, RAWMOUSE, RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD,
    RIM_TYPEMOUSE,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, EnumWindows, GetAncestor, GetClientRect, GetCursorPos, GetForegroundWindow,
    GetMessageExtraInfo, GetSystemMetrics, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId,
    IsChild, IsWindow, IsWindowVisible, SetWindowsHookExW, UnhookWindowsHookEx, WindowFromPoint,
    GA_ROOT, GA_ROOTOWNER,
    HHOOK, MSG, PM_REMOVE, RI_KEY_BREAK, RI_KEY_E0, RI_MOUSE_BUTTON_4_DOWN, RI_MOUSE_BUTTON_4_UP,
    RI_MOUSE_BUTTON_5_DOWN, RI_MOUSE_BUTTON_5_UP, RI_MOUSE_HWHEEL, RI_MOUSE_LEFT_BUTTON_DOWN,
    RI_MOUSE_LEFT_BUTTON_UP, RI_MOUSE_MIDDLE_BUTTON_DOWN, RI_MOUSE_MIDDLE_BUTTON_UP,
    RI_MOUSE_RIGHT_BUTTON_DOWN, RI_MOUSE_RIGHT_BUTTON_UP, RI_MOUSE_WHEEL, SM_CXDOUBLECLK,
    SM_CYDOUBLECLK, SM_SWAPBUTTON, WHEEL_DELTA, WH_GETMESSAGE, WM_INPUT, WM_KEYDOWN, WM_KEYUP,
    WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDBLCLK, WM_MBUTTONDOWN,
    WM_MBUTTONUP, WM_MOUSEHWHEEL, WM_MOUSEWHEEL, WM_RBUTTONDBLCLK, WM_RBUTTONDOWN, WM_RBUTTONUP,
    WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDBLCLK, WM_XBUTTONDOWN, WM_XBUTTONUP, XBUTTON1,
};

use crate::abi::{
    Chrome, QueuedEvent, Snapshot, ABI_VERSION, EV_KEY_DOWN, EV_KEY_UP, EV_POINTER_DOWN,
    EV_POINTER_UP, EV_WHEEL, FLAG_FOCUSED, FLAG_INSIDE, FLAG_VALID, KEY_BYTES, MOD_ALT, MOD_CTRL,
    MOD_META, MOD_SHIFT, PTR_MOUSE, PTR_PEN, QUEUE_CAP,
};

/// One wheel notch in CSS pixels. Same value the X11 backend reports.
const WHEEL_STEP: f32 = 16.0;

/// `GetMessageExtraInfo` signature for pen / touch synthesized mouse input.
const PEN_SIGNATURE: usize = 0xFF51_5700;
const PEN_SIGNATURE_MASK: usize = 0xFFFF_FF00;

struct Queue {
    events: [QueuedEvent; QUEUE_CAP],
    head: usize,
    count: usize,
}

/// Last few queued events, used to drop the same input when raw input and a
/// legacy `WM_*` message both report it. Mirrors the macOS sampler dedupe.
const RECENT_CAP: usize = 8;
const DEDUPE: Duration = Duration::from_millis(8);

#[derive(Clone, Copy)]
struct Recent {
    type_: u32,
    button: u32,
    key_code: u32,
    click_count: u32,
    client_x: f32,
    client_y: f32,
    delta_x: f32,
    delta_y: f32,
    at: Option<Instant>,
}

impl Recent {
    const fn empty() -> Self {
        Self {
            type_: 0,
            button: 0,
            key_code: 0,
            click_count: 0,
            client_x: 0.0,
            client_y: 0.0,
            delta_x: 0.0,
            delta_y: 0.0,
            at: None,
        }
    }
}

/// Where and when a button last went down, so raw input can tell a double
/// click from two clicks the way `WM_LBUTTONDBLCLK` would. `count` outlives the
/// press because the release has to report it too: `dblclick` is emitted on the
/// second *up*, and Win32 never puts a count on a `WM_*BUTTONUP`.
#[derive(Clone, Copy)]
struct Click {
    at: Option<Instant>,
    x: i32,
    y: i32,
    count: u32,
}

impl Click {
    const fn empty() -> Self {
        Self {
            at: None,
            x: 0,
            y: 0,
            count: 1,
        }
    }
}

/// DOM button indices we track: primary, auxiliary, secondary, X1, X2.
const BUTTONS: usize = 5;

struct State {
    queue: Queue,
    /// Attached `HWND`, kept as `isize` so `State` stays `Send`.
    attached: isize,
    hook: isize,
    hook_thread: u32,
    raw_input: bool,
    recent: [Recent; RECENT_CAP],
    recent_n: usize,
    clicks: [Click; BUTTONS],
    /// Buttons whose press we claimed, so their release is ours to report even
    /// if the pointer has since left the view.
    held: u32,
}

static STATE: Mutex<State> = Mutex::new(State {
    queue: Queue {
        events: [QueuedEvent::empty(); QUEUE_CAP],
        head: 0,
        count: 0,
    },
    attached: 0,
    hook: 0,
    hook_thread: 0,
    raw_input: false,
    recent: [Recent::empty(); RECENT_CAP],
    recent_n: 0,
    clicks: [Click::empty(); BUTTONS],
    held: 0,
});

fn hwnd_from_ptr(ptr: *mut c_void) -> Option<HWND> {
    if ptr.is_null() {
        None
    } else {
        Some(ptr as HWND)
    }
}

fn attached_hwnd() -> Option<HWND> {
    let handle = STATE.lock().expect("rdu state").attached;
    if handle == 0 {
        None
    } else {
        Some(handle as HWND)
    }
}

/// Toggle state (Caps Lock and friends). There is no async form of this, so it
/// is the one bit that stays synchronized to this thread's message queue.
fn key_toggled(vk: i32) -> bool {
    unsafe { GetKeyState(vk) & 1 != 0 }
}

fn async_key_down(vk: i32) -> bool {
    unsafe { (GetAsyncKeyState(vk) as u16) & 0x8000 != 0 }
}

/// Live modifier state. `GetKeyState` is synchronized to the messages *this*
/// thread has taken off its queue, and raw input runs ahead of those (under
/// WebView2 they never arrive at all), so the physical state is the honest
/// answer for both paths: a Shift keydown must already report `shiftKey`.
fn current_modifiers() -> u32 {
    let mut m = 0;
    if async_key_down(VK_SHIFT as i32) {
        m |= MOD_SHIFT;
    }
    if async_key_down(VK_CONTROL as i32) {
        m |= MOD_CTRL;
    }
    if async_key_down(VK_MENU as i32) {
        m |= MOD_ALT;
    }
    if async_key_down(VK_LWIN as i32) || async_key_down(VK_RWIN as i32) {
        m |= MOD_META;
    }
    m
}

fn buttons_swapped() -> bool {
    unsafe { GetSystemMetrics(SM_SWAPBUTTON) != 0 }
}

/// Live `MouseEvent.buttons`. `VK_LBUTTON` tracks the physical button, so the
/// primary / secondary bits are swapped back to agree with the WM_* messages.
fn current_buttons() -> u32 {
    let (primary, secondary) = if buttons_swapped() {
        (VK_RBUTTON, VK_LBUTTON)
    } else {
        (VK_LBUTTON, VK_RBUTTON)
    };
    let mut buttons = 0;
    if async_key_down(primary as i32) {
        buttons |= 1;
    }
    if async_key_down(secondary as i32) {
        buttons |= 2;
    }
    if async_key_down(VK_MBUTTON as i32) {
        buttons |= 4;
    }
    if async_key_down(VK_XBUTTON1 as i32) {
        buttons |= 8;
    }
    if async_key_down(VK_XBUTTON2 as i32) {
        buttons |= 16;
    }
    buttons
}

/// `MouseEvent.buttons` from the `MK_*` flags carried by a mouse message.
fn buttons_from_mk(wparam: WPARAM) -> u32 {
    let mk = (wparam & 0xFFFF) as u32;
    let mut buttons = 0;
    if mk & MK_LBUTTON != 0 {
        buttons |= 1;
    }
    if mk & MK_RBUTTON != 0 {
        buttons |= 2;
    }
    if mk & MK_MBUTTON != 0 {
        buttons |= 4;
    }
    if mk & MK_XBUTTON1 != 0 {
        buttons |= 8;
    }
    if mk & MK_XBUTTON2 != 0 {
        buttons |= 16;
    }
    buttons
}

/// Modifiers a mouse message knows about, plus Alt / Meta from the key state.
fn modifiers_from_mk(wparam: WPARAM) -> u32 {
    let mk = (wparam & 0xFFFF) as u32;
    let mut m = 0;
    if mk & MK_SHIFT != 0 {
        m |= MOD_SHIFT;
    }
    if mk & MK_CONTROL != 0 {
        m |= MOD_CTRL;
    }
    if async_key_down(VK_MENU as i32) {
        m |= MOD_ALT;
    }
    if async_key_down(VK_LWIN as i32) || async_key_down(VK_RWIN as i32) {
        m |= MOD_META;
    }
    m
}

fn loword(value: usize) -> u16 {
    (value & 0xFFFF) as u16
}

fn hiword(value: usize) -> u16 {
    ((value >> 16) & 0xFFFF) as u16
}

fn lparam_x(lparam: LPARAM) -> i32 {
    (lparam as u32 & 0xFFFF) as i16 as i32
}

fn lparam_y(lparam: LPARAM) -> i32 {
    ((lparam as u32 >> 16) & 0xFFFF) as i16 as i32
}

/// Pen- and touch-generated mouse input carries a signature in the message
/// extra info. Inside the hook the message has not been retrieved yet, so this
/// is the previous message's extra info — close enough to label `pointerType`,
/// and it never reports pen on a machine with no pen. Pressure and tilt would
/// need `WM_POINTER`, which winit does not opt into.
fn pointer_kind_from_extra_info() -> u32 {
    let info = unsafe { GetMessageExtraInfo() } as usize;
    if info & PEN_SIGNATURE_MASK == PEN_SIGNATURE {
        PTR_PEN
    } else {
        PTR_MOUSE
    }
}

#[derive(Clone, Copy)]
struct Mapped {
    client_x: f32,
    client_y: f32,
    screen_x: f32,
    screen_y: f32,
}

/// Outer chrome plus the nearest monitor. `devicePixelRatio` is 1:
/// `GetClientRect` and `getSize()` are already unscaled device pixels.
fn window_chrome(hwnd: HWND, view_w: f32, view_h: f32) -> Chrome {
    let root = unsafe {
        let ancestor = GetAncestor(hwnd, GA_ROOT);
        if ancestor.is_null() {
            hwnd
        } else {
            ancestor
        }
    };
    let mut chrome = Chrome {
        device_pixel_ratio: 1.0,
        outer_w: view_w,
        outer_h: view_h,
        ..Chrome::empty()
    };
    let mut frame = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(root, &mut frame) } != 0 {
        chrome.window_x = frame.left as f32;
        chrome.window_y = frame.top as f32;
        chrome.outer_w = (frame.right - frame.left) as f32;
        chrome.outer_h = (frame.bottom - frame.top) as f32;
    }
    let monitor = unsafe { MonitorFromWindow(root, MONITOR_DEFAULTTONEAREST) };
    if !monitor.is_null() {
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            rcMonitor: RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            rcWork: RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            dwFlags: 0,
        };
        if unsafe { GetMonitorInfoW(monitor, &mut info) } != 0 {
            chrome.screen_w = (info.rcMonitor.right - info.rcMonitor.left) as f32;
            chrome.screen_h = (info.rcMonitor.bottom - info.rcMonitor.top) as f32;
            chrome.avail_x = info.rcWork.left as f32;
            chrome.avail_y = info.rcWork.top as f32;
            chrome.avail_w = (info.rcWork.right - info.rcWork.left) as f32;
            chrome.avail_h = (info.rcWork.bottom - info.rcWork.top) as f32;
        }
    }
    chrome
}

/// Map a screen point into the attached window's client space.
fn map_screen(hwnd: HWND, screen: POINT) -> Mapped {
    let mut client = screen;
    unsafe {
        ScreenToClient(hwnd, &mut client);
    }
    Mapped {
        client_x: client.x as f32,
        client_y: client.y as f32,
        screen_x: screen.x as f32,
        screen_y: screen.y as f32,
    }
}

/// A client point of `from` (usually the message window) in screen space.
fn client_to_screen(from: HWND, x: i32, y: i32) -> POINT {
    let mut point = POINT { x, y };
    unsafe {
        ClientToScreen(from, &mut point);
    }
    point
}

fn same_recent(a: &Recent, ev: &QueuedEvent) -> bool {
    a.type_ == ev.type_
        && a.button == ev.button
        && a.key_code == ev.key_code
        && a.click_count == ev.click_count
        && (a.client_x - ev.client_x).abs() < 1.0
        && (a.client_y - ev.client_y).abs() < 1.0
        && (a.delta_x - ev.delta_x).abs() < 0.5
        && (a.delta_y - ev.delta_y).abs() < 0.5
}

/// Queue one event, unless raw input and a legacy message just reported the
/// same one. Key auto-repeat is slower than `DEDUPE`, so repeats survive.
fn push(state: &mut State, ev: QueuedEvent) {
    let now = Instant::now();
    let seen = state.recent[..state.recent_n].iter().any(|recent| {
        recent
            .at
            .is_some_and(|at| now.duration_since(at) <= DEDUPE && same_recent(recent, &ev))
    });
    if seen {
        return;
    }
    let slot = if state.recent_n < RECENT_CAP {
        state.recent_n += 1;
        state.recent_n - 1
    } else {
        state.recent.rotate_left(1);
        RECENT_CAP - 1
    };
    state.recent[slot] = Recent {
        type_: ev.type_,
        button: ev.button,
        key_code: ev.key_code,
        click_count: ev.click_count,
        client_x: ev.client_x,
        client_y: ev.client_y,
        delta_x: ev.delta_x,
        delta_y: ev.delta_y,
        at: Some(now),
    };
    let q = &mut state.queue;
    if q.count == QUEUE_CAP {
        q.head = (q.head + 1) % QUEUE_CAP;
        q.count -= 1;
    }
    let tail = (q.head + q.count) % QUEUE_CAP;
    q.events[tail] = ev;
    q.count += 1;
}

/// Does this message belong to the attached window (or one of its children)?
fn message_is_ours(hwnd: HWND, msg_hwnd: HWND) -> bool {
    if msg_hwnd.is_null() {
        // Thread messages (WM_TIMER and friends) have no window.
        return false;
    }
    msg_hwnd == hwnd || unsafe { IsChild(hwnd, msg_hwnd) != 0 }
}

/// Is the cursor over the attached view, with nothing on top of it?
fn cursor_is_over(hwnd: HWND, cursor: POINT, mapped: &Mapped, width: f32, height: f32) -> bool {
    let in_bounds = mapped.client_x >= 0.0
        && mapped.client_y >= 0.0
        && mapped.client_x < width
        && mapped.client_y < height;
    if !in_bounds {
        return false;
    }
    // Another window on top of ours means the pointer is not over the view.
    // The WebView2 render surface is a child of ours and still counts.
    let under_cursor = unsafe { WindowFromPoint(cursor) };
    !under_cursor.is_null()
        && (under_cursor == hwnd || unsafe { IsChild(hwnd, under_cursor) != 0 })
}

/// The cursor's position over the view, or `None` when it is elsewhere.
/// Raw input arrives even when the click was aimed at another window.
fn cursor_over_view(hwnd: HWND) -> Option<(POINT, Mapped)> {
    let mut cursor = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } == 0 {
        return None;
    }
    let mut client = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetClientRect(hwnd, &mut client) } == 0 {
        return None;
    }
    let mapped = map_screen(hwnd, cursor);
    let width = (client.right - client.left) as f32;
    let height = (client.bottom - client.top) as f32;
    if cursor_is_over(hwnd, cursor, &mapped, width, height) {
        Some((cursor, mapped))
    } else {
        None
    }
}

/// Does the attached window hold the focus? WebView2 puts its context menus in
/// owned popups, so the owner chain counts as focus too.
fn window_has_focus(hwnd: HWND) -> bool {
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.is_null() {
        return false;
    }
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    foreground == hwnd
        || foreground == root
        || unsafe { IsChild(foreground, hwnd) != 0 }
        || unsafe { GetAncestor(foreground, GA_ROOTOWNER) } == root
}

fn raw_devices(hwnd: HWND, flags: u32) -> [RAWINPUTDEVICE; 2] {
    [
        RAWINPUTDEVICE {
            usUsagePage: HID_USAGE_PAGE_GENERIC,
            usUsage: HID_USAGE_GENERIC_MOUSE,
            dwFlags: flags,
            hwndTarget: hwnd,
        },
        RAWINPUTDEVICE {
            usUsagePage: HID_USAGE_PAGE_GENERIC,
            usUsage: HID_USAGE_GENERIC_KEYBOARD,
            dwFlags: flags,
            hwndTarget: hwnd,
        },
    ]
}

fn set_raw_devices(hwnd: HWND, flags: u32) -> bool {
    let devices = raw_devices(hwnd, flags);
    unsafe {
        RegisterRawInputDevices(
            devices.as_ptr(),
            devices.len() as u32,
            size_of::<RAWINPUTDEVICE>() as u32,
        ) != 0
    }
}

/// Ask for `WM_INPUT` on this window even while another process has focus.
/// Without `RIDEV_NOLEGACY` the host keeps its own input untouched.
fn register_raw_input(hwnd: HWND) -> bool {
    set_raw_devices(hwnd, RIDEV_INPUTSINK)
}

fn unregister_raw_input() {
    // `RIDEV_REMOVE` requires a null target.
    set_raw_devices(ptr::null_mut(), RIDEV_REMOVE);
}

fn read_raw_input(handle: HRAWINPUT) -> Option<RAWINPUT> {
    let mut data = RAWINPUT::default();
    let mut size = size_of::<RAWINPUT>() as u32;
    let read = unsafe {
        GetRawInputData(
            handle,
            RID_INPUT,
            &mut data as *mut RAWINPUT as *mut c_void,
            &mut size,
            size_of::<RAWINPUTHEADER>() as u32,
        )
    };
    // `GetRawInputData` reports failure as -1.
    if read == u32::MAX {
        None
    } else {
        Some(data)
    }
}

/// DOM button for a raw button pair. Raw input reports the *physical* button,
/// so a swapped mouse has to be mapped back the way `current_buttons` does.
fn raw_dom_button(physical_left: bool) -> u32 {
    if physical_left != buttons_swapped() {
        0
    } else {
        2
    }
}

/// `detail` for a press, counting a second click in the system's double-click
/// time and slop as 2. Reporting 2 consumes the streak, like `WM_LBUTTONDBLCLK`.
fn click_count(state: &mut State, button: u32, cursor: POINT) -> u32 {
    let Some(track) = state.clicks.get_mut(button as usize) else {
        return 1;
    };
    let now = Instant::now();
    let limit = Duration::from_millis(unsafe { GetDoubleClickTime() } as u64);
    let slop_x = unsafe { GetSystemMetrics(SM_CXDOUBLECLK) } / 2;
    let slop_y = unsafe { GetSystemMetrics(SM_CYDOUBLECLK) } / 2;
    let double = track.at.is_some_and(|at| now.duration_since(at) <= limit)
        && (cursor.x - track.x).abs() <= slop_x
        && (cursor.y - track.y).abs() <= slop_y;
    track.at = if double { None } else { Some(now) };
    track.x = cursor.x;
    track.y = cursor.y;
    track.count = if double { 2 } else { 1 };
    track.count
}

/// The click count of the press this release ends.
fn released_click_count(state: &State, button: u32) -> u32 {
    state
        .clicks
        .get(button as usize)
        .map_or(1, |track| track.count)
}

/// Record a press a legacy `WM_*BUTTONDOWN` already counted, so its release
/// reports the same count as one raw input counted.
fn remember_click(state: &mut State, button: u32, count: u32) {
    if let Some(track) = state.clicks.get_mut(button as usize) {
        track.count = count;
    }
}

fn handle_raw_mouse(hwnd: HWND, mouse: &RAWMOUSE) {
    let flags = unsafe { mouse.Anonymous.Anonymous.usButtonFlags } as u32;
    if flags == 0 {
        // Movement only; the snapshot already tracks the cursor.
        return;
    }
    let over = cursor_over_view(hwnd);
    let mut state = STATE.lock().expect("rdu state");

    if flags & (RI_MOUSE_WHEEL | RI_MOUSE_HWHEEL) != 0 {
        let Some((_, mapped)) = over else {
            return;
        };
        let notches =
            unsafe { mouse.Anonymous.Anonymous.usButtonData } as i16 as f32 / WHEEL_DELTA as f32;
        let mut ev = QueuedEvent::empty();
        ev.type_ = EV_WHEEL;
        if flags & RI_MOUSE_WHEEL != 0 {
            // Rolling the wheel forward scrolls up, which is a negative deltaY.
            ev.delta_y = -notches * WHEEL_STEP;
        } else {
            ev.delta_x = notches * WHEEL_STEP;
        }
        ev.buttons = current_buttons();
        ev.modifiers = current_modifiers();
        ev.pointer_type = PTR_MOUSE;
        ev.client_x = mapped.client_x;
        ev.client_y = mapped.client_y;
        ev.screen_x = mapped.screen_x;
        ev.screen_y = mapped.screen_y;
        push(&mut state, ev);
        return;
    }

    const EDGES: [(u32, u32, bool); 10] = [
        (RI_MOUSE_LEFT_BUTTON_DOWN, 0, true),
        (RI_MOUSE_LEFT_BUTTON_UP, 0, false),
        (RI_MOUSE_RIGHT_BUTTON_DOWN, 2, true),
        (RI_MOUSE_RIGHT_BUTTON_UP, 2, false),
        (RI_MOUSE_MIDDLE_BUTTON_DOWN, 1, true),
        (RI_MOUSE_MIDDLE_BUTTON_UP, 1, false),
        (RI_MOUSE_BUTTON_4_DOWN, 3, true),
        (RI_MOUSE_BUTTON_4_UP, 3, false),
        (RI_MOUSE_BUTTON_5_DOWN, 4, true),
        (RI_MOUSE_BUTTON_5_UP, 4, false),
    ];

    for (flag, raw_button, down) in EDGES {
        if flags & flag == 0 {
            continue;
        }
        // Only the primary / secondary pair follows the swap setting.
        let button = match raw_button {
            0 => raw_dom_button(true),
            2 => raw_dom_button(false),
            other => other,
        };
        let bit = 1u32 << button.min(31);
        if down && over.is_none() {
            continue;
        }
        if !down && over.is_none() && state.held & bit == 0 {
            continue;
        }
        let (cursor, mapped) = match over {
            Some(pair) => pair,
            None => {
                let mut cursor = POINT { x: 0, y: 0 };
                if unsafe { GetCursorPos(&mut cursor) } == 0 {
                    continue;
                }
                (cursor, map_screen(hwnd, cursor))
            }
        };
        let mut ev = QueuedEvent::empty();
        ev.type_ = if down { EV_POINTER_DOWN } else { EV_POINTER_UP };
        ev.button = button;
        ev.click_count = if down {
            click_count(&mut state, button, cursor)
        } else {
            released_click_count(&state, button)
        };
        ev.buttons = current_buttons();
        ev.modifiers = current_modifiers();
        ev.pointer_type = pointer_kind_from_extra_info();
        ev.client_x = mapped.client_x;
        ev.client_y = mapped.client_y;
        ev.screen_x = mapped.screen_x;
        ev.screen_y = mapped.screen_y;
        if down {
            state.held |= bit;
        } else {
            state.held &= !bit;
        }
        push(&mut state, ev);
    }
}

fn handle_raw_keyboard(hwnd: HWND, keyboard: &RAWKEYBOARD) {
    // 0xFF is the filler half of an E1 sequence (Pause), not a real key.
    if keyboard.VKey == 0xFF || !window_has_focus(hwnd) {
        return;
    }
    let flags = keyboard.Flags as u32;
    let down = flags & RI_KEY_BREAK == 0;
    // Rebuild the `lParam` bits `resolve_side` and `characters` read.
    let extended = if flags & RI_KEY_E0 != 0 { 1 << 24 } else { 0 };
    let lparam = (((keyboard.MakeCode as LPARAM) & 0xFF) << 16) | extended;
    push_key(hwnd, keyboard.VKey as u32, lparam, down);
}

fn handle_raw_input(hwnd: HWND, handle: HRAWINPUT) {
    let Some(data) = read_raw_input(handle) else {
        return;
    };
    match data.header.dwType {
        RIM_TYPEMOUSE => handle_raw_mouse(hwnd, unsafe { &data.data.mouse }),
        RIM_TYPEKEYBOARD => handle_raw_keyboard(hwnd, unsafe { &data.data.keyboard }),
        _ => {}
    }
}

/// Resolve the generic modifier virtual keys to their left / right variant so
/// the key table can report `ShiftRight` instead of a sideless `Shift`.
fn resolve_side(vk: u32, lparam: LPARAM) -> u32 {
    let scan = ((lparam >> 16) & 0xFF) as u32;
    let extended = (lparam >> 24) & 1 != 0;
    match vk as u16 {
        VK_SHIFT => {
            let mapped = unsafe { MapVirtualKeyW(scan, MAPVK_VSC_TO_VK_EX) };
            if mapped == 0 {
                VK_LSHIFT as u32
            } else {
                mapped
            }
        }
        VK_CONTROL if extended => VK_RCONTROL as u32,
        VK_CONTROL => VK_LCONTROL as u32,
        VK_MENU if extended => VK_RMENU as u32,
        VK_MENU => VK_LMENU as u32,
        _ => vk,
    }
}

/// UTF-8 text a key message would produce, ignoring Ctrl unless it is AltGr.
fn characters(vk: u32, lparam: LPARAM) -> Option<String> {
    let mut keys = [0u8; 256];
    if unsafe { GetKeyboardState(keys.as_mut_ptr()) } == 0 {
        return None;
    }
    // Same staleness as `current_modifiers`: refresh the keys that decide the
    // character from the physical state. Caps Lock has no async form, so its
    // toggle bit comes from the queue-synchronized `GetKeyState`.
    for vk in [
        VK_SHIFT, VK_LSHIFT, VK_RSHIFT, VK_CONTROL, VK_LCONTROL, VK_RCONTROL, VK_MENU, VK_LMENU,
        VK_RMENU,
    ] {
        keys[vk as usize] = if async_key_down(vk as i32) { 0x80 } else { 0 };
    }
    keys[VK_CAPITAL as usize] = u8::from(key_toggled(VK_CAPITAL as i32));
    let alt_gr = keys[VK_RMENU as usize] & 0x80 != 0 && keys[VK_CONTROL as usize] & 0x80 != 0;
    if !alt_gr {
        keys[VK_CONTROL as usize] = 0;
        keys[VK_LCONTROL as usize] = 0;
        keys[VK_RCONTROL as usize] = 0;
        keys[VK_MENU as usize] = 0;
        keys[VK_LMENU as usize] = 0;
        keys[VK_RMENU as usize] = 0;
    }
    let scan = ((lparam >> 16) & 0xFF) as u32;
    let layout = unsafe { GetKeyboardLayout(0) };
    let mut buf = [0u16; 8];
    // Bit 2 leaves the kernel keyboard state alone, so dead keys still work.
    let n = unsafe {
        ToUnicodeEx(
            vk,
            scan,
            keys.as_ptr(),
            buf.as_mut_ptr(),
            buf.len() as i32,
            1 << 2,
            layout,
        )
    };
    if n <= 0 {
        return None;
    }
    let text = String::from_utf16_lossy(&buf[..n as usize]);
    // Control characters are not a `KeyboardEvent.key`; let the VK table win.
    if text.chars().all(|c| (c as u32) < 0x20) {
        return None;
    }
    Some(text)
}

fn set_key_text(ev: &mut QueuedEvent, text: &str) {
    let bytes = text.as_bytes();
    let mut n = bytes.len().min(KEY_BYTES);
    while n > 0 && !text.is_char_boundary(n) {
        n -= 1;
    }
    ev.key[..n].copy_from_slice(&bytes[..n]);
    ev.key_len = n as u32;
}

/// Queue a key event. `lparam` only has to carry the scan code and the
/// extended bit, so raw input can synthesize one.
fn push_key(hwnd: HWND, vk: u32, lparam: LPARAM, down: bool) {
    let mut ev = QueuedEvent::empty();
    ev.type_ = if down { EV_KEY_DOWN } else { EV_KEY_UP };
    ev.pointer_type = PTR_MOUSE;
    ev.key_code = resolve_side(vk, lparam);
    ev.buttons = current_buttons();
    ev.modifiers = current_modifiers();
    if let Some(text) = characters(vk, lparam) {
        set_key_text(&mut ev, &text);
    }
    // Key events carry no cursor position; use the live cursor.
    let mut cursor = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } != 0 {
        let mapped = map_screen(hwnd, cursor);
        ev.client_x = mapped.client_x;
        ev.client_y = mapped.client_y;
        ev.screen_x = mapped.screen_x;
        ev.screen_y = mapped.screen_y;
    }
    push(&mut STATE.lock().expect("rdu state"), ev);
}

/// Translate one posted message into a queued event, if it is input.
fn handle_message(msg: &MSG) {
    let Some(hwnd) = attached_hwnd() else {
        return;
    };
    if !message_is_ours(hwnd, msg.hwnd) {
        return;
    }

    // `WM_INPUT` carries a handle, not coordinates, so it cannot fall through
    // to the `lParam` decoding below.
    if msg.message == WM_INPUT {
        handle_raw_input(hwnd, msg.lParam as HRAWINPUT);
        return;
    }

    let mut ev = QueuedEvent::empty();
    ev.pointer_type = PTR_MOUSE;

    // Button messages carry client coordinates of `msg.hwnd`; wheel messages
    // already use screen coordinates.
    let screen = match msg.message {
        WM_MOUSEWHEEL | WM_MOUSEHWHEEL => POINT {
            x: lparam_x(msg.lParam),
            y: lparam_y(msg.lParam),
        },
        _ => client_to_screen(msg.hwnd, lparam_x(msg.lParam), lparam_y(msg.lParam)),
    };

    match msg.message {
        WM_LBUTTONDOWN | WM_LBUTTONDBLCLK | WM_RBUTTONDOWN | WM_RBUTTONDBLCLK | WM_MBUTTONDOWN
        | WM_MBUTTONDBLCLK | WM_XBUTTONDOWN | WM_XBUTTONDBLCLK => {
            ev.type_ = EV_POINTER_DOWN;
            ev.button = match msg.message {
                WM_LBUTTONDOWN | WM_LBUTTONDBLCLK => 0,
                WM_MBUTTONDOWN | WM_MBUTTONDBLCLK => 1,
                WM_RBUTTONDOWN | WM_RBUTTONDBLCLK => 2,
                _ if hiword(msg.wParam) == XBUTTON1 as u16 => 3,
                _ => 4,
            };
            ev.click_count = match msg.message {
                WM_LBUTTONDBLCLK | WM_RBUTTONDBLCLK | WM_MBUTTONDBLCLK | WM_XBUTTONDBLCLK => 2,
                _ => 1,
            };
            remember_click(
                &mut STATE.lock().expect("rdu state"),
                ev.button,
                ev.click_count,
            );
            ev.buttons = buttons_from_mk(msg.wParam);
            ev.modifiers = modifiers_from_mk(msg.wParam);
            ev.pointer_type = pointer_kind_from_extra_info();
        }
        WM_LBUTTONUP | WM_RBUTTONUP | WM_MBUTTONUP | WM_XBUTTONUP => {
            ev.type_ = EV_POINTER_UP;
            ev.button = match msg.message {
                WM_LBUTTONUP => 0,
                WM_MBUTTONUP => 1,
                WM_RBUTTONUP => 2,
                _ if hiword(msg.wParam) == XBUTTON1 as u16 => 3,
                _ => 4,
            };
            ev.click_count = released_click_count(&STATE.lock().expect("rdu state"), ev.button);
            ev.buttons = buttons_from_mk(msg.wParam);
            ev.modifiers = modifiers_from_mk(msg.wParam);
            ev.pointer_type = pointer_kind_from_extra_info();
        }
        WM_MOUSEWHEEL => {
            ev.type_ = EV_WHEEL;
            let notches = hiword(msg.wParam) as i16 as f32 / WHEEL_DELTA as f32;
            // Rolling the wheel forward scrolls up, which is a negative deltaY.
            ev.delta_y = -notches * WHEEL_STEP;
            ev.buttons = buttons_from_mk(msg.wParam);
            ev.modifiers = modifiers_from_mk(msg.wParam);
        }
        WM_MOUSEHWHEEL => {
            ev.type_ = EV_WHEEL;
            let notches = hiword(msg.wParam) as i16 as f32 / WHEEL_DELTA as f32;
            ev.delta_x = notches * WHEEL_STEP;
            ev.buttons = buttons_from_mk(msg.wParam);
            ev.modifiers = modifiers_from_mk(msg.wParam);
        }
        WM_KEYDOWN | WM_SYSKEYDOWN | WM_KEYUP | WM_SYSKEYUP => {
            let down = msg.message == WM_KEYDOWN || msg.message == WM_SYSKEYDOWN;
            push_key(hwnd, loword(msg.wParam) as u32, msg.lParam, down);
            return;
        }
        _ => return,
    }

    let mapped = map_screen(hwnd, screen);
    ev.client_x = mapped.client_x;
    ev.client_y = mapped.client_y;
    ev.screen_x = mapped.screen_x;
    ev.screen_y = mapped.screen_y;
    push(&mut STATE.lock().expect("rdu state"), ev);
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // Only look at messages that are really being removed from the queue; a
    // PeekMessage without PM_REMOVE would otherwise report them twice.
    if code >= 0 && wparam as u32 == PM_REMOVE && !(lparam as *const MSG).is_null() {
        handle_message(unsafe { &*(lparam as *const MSG) });
    }
    let hook = STATE.lock().expect("rdu state").hook as HHOOK;
    unsafe { CallNextHookEx(hook, code, wparam, lparam) }
}

struct FindByTitle {
    want: Vec<u16>,
    found: HWND,
}

fn owned_by_this_process(hwnd: HWND) -> bool {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    pid != 0 && pid == unsafe { GetCurrentProcessId() }
}

unsafe extern "system" fn enum_by_title(hwnd: HWND, lparam: LPARAM) -> i32 {
    let ctx = unsafe { &mut *(lparam as *mut FindByTitle) };
    if !owned_by_this_process(hwnd) {
        return 1;
    }
    let mut buf = [0u16; 512];
    let n = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if n > 0 && buf[..n as usize] == ctx.want[..] {
        ctx.found = hwnd;
        return 0;
    }
    1
}

unsafe extern "system" fn enum_first_visible(hwnd: HWND, lparam: LPARAM) -> i32 {
    let out = unsafe { &mut *(lparam as *mut HWND) };
    if owned_by_this_process(hwnd) && unsafe { IsWindowVisible(hwnd) } != 0 {
        *out = hwnd;
        return 0;
    }
    1
}

#[no_mangle]
pub extern "C" fn rdu_abi_version() -> i32 {
    ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn rdu_find_window(utf8_title: *const c_char) -> *mut c_void {
    if utf8_title.is_null() {
        return ptr::null_mut();
    }
    let want = unsafe { CStr::from_ptr(utf8_title) }.to_string_lossy();
    let mut ctx = FindByTitle {
        want: want.encode_utf16().collect(),
        found: ptr::null_mut(),
    };
    unsafe {
        EnumWindows(Some(enum_by_title), &mut ctx as *mut FindByTitle as LPARAM);
    }
    ctx.found as *mut c_void
}

#[no_mangle]
pub extern "C" fn rdu_find_front_window() -> *mut c_void {
    let foreground = unsafe { GetForegroundWindow() };
    if !foreground.is_null() && owned_by_this_process(foreground) {
        return foreground as *mut c_void;
    }
    let mut found: HWND = ptr::null_mut();
    unsafe {
        EnumWindows(Some(enum_first_visible), &mut found as *mut HWND as LPARAM);
    }
    found as *mut c_void
}

fn remove_hook(state: &mut State) {
    if state.hook != 0 {
        unsafe { UnhookWindowsHookEx(state.hook as HHOOK) };
        state.hook = 0;
        state.hook_thread = 0;
    }
}

#[no_mangle]
pub extern "C" fn rdu_attach(view_ptr: *mut c_void) -> i32 {
    let Some(hwnd) = hwnd_from_ptr(view_ptr) else {
        return 0;
    };
    if unsafe { IsWindow(hwnd) } == 0 {
        return 0;
    }
    let thread = unsafe { GetWindowThreadProcessId(hwnd, ptr::null_mut()) };
    if thread == 0 {
        return 0;
    }
    let mut state = STATE.lock().expect("rdu state");
    state.attached = hwnd as isize;
    state.queue.head = 0;
    state.queue.count = 0;
    state.recent_n = 0;
    state.clicks = [Click::empty(); BUTTONS];
    state.held = 0;
    // Point raw input at this window even on a re-attach: the target moves with
    // the handle, and re-registering the same usage pages is not an error.
    state.raw_input = register_raw_input(hwnd);
    if state.hook != 0 && state.hook_thread == thread {
        return 1;
    }
    remove_hook(&mut state);
    // A thread-local hook inside this process takes a null module handle.
    let hook = unsafe { SetWindowsHookExW(WH_GETMESSAGE, Some(hook_proc), ptr::null_mut(), thread) };
    if hook.is_null() {
        state.attached = 0;
        return 0;
    }
    state.hook = hook as isize;
    state.hook_thread = thread;
    1
}

#[no_mangle]
pub extern "C" fn rdu_detach(view_ptr: *mut c_void) {
    let mut state = STATE.lock().expect("rdu state");
    if !view_ptr.is_null() && state.attached != view_ptr as isize {
        return;
    }
    state.attached = 0;
    state.queue.head = 0;
    state.queue.count = 0;
    state.recent_n = 0;
    state.held = 0;
    if state.raw_input {
        unregister_raw_input();
        state.raw_input = false;
    }
    remove_hook(&mut state);
}

#[no_mangle]
pub unsafe extern "C" fn rdu_snapshot(view_ptr: *mut c_void, out: *mut Snapshot) -> i32 {
    if out.is_null() {
        return 0;
    }
    unsafe {
        *out = Snapshot::empty();
    }
    let Some(hwnd) = hwnd_from_ptr(view_ptr) else {
        return 0;
    };
    if unsafe { IsWindow(hwnd) } == 0 {
        return 0;
    }
    let mut cursor = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } == 0 {
        return 0;
    }
    let mut client = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetClientRect(hwnd, &mut client) } == 0 {
        return 0;
    }

    let mapped = map_screen(hwnd, cursor);
    let width = (client.right - client.left) as f32;
    let height = (client.bottom - client.top) as f32;
    let inside = cursor_is_over(hwnd, cursor, &mapped, width, height);

    let mut snap = Snapshot {
        flags: FLAG_VALID
            | if inside { FLAG_INSIDE } else { 0 }
            | if window_has_focus(hwnd) { FLAG_FOCUSED } else { 0 },
        client_x: mapped.client_x,
        client_y: mapped.client_y,
        screen_x: mapped.screen_x,
        screen_y: mapped.screen_y,
        buttons: current_buttons(),
        modifiers: current_modifiers(),
        // No pressure without WM_POINTER; the session falls back to buttons.
        pressure: -1.0,
        tilt_x: 0.0,
        tilt_y: 0.0,
        twist: 0.0,
        pointer_type: PTR_MOUSE,
        ..Snapshot::empty()
    };
    snap.inner_w = width;
    snap.inner_h = height;
    snap.apply_chrome(window_chrome(hwnd, width, height));
    unsafe {
        *out = snap;
    }
    1
}

#[no_mangle]
pub unsafe extern "C" fn rdu_poll_events(
    _view_ptr: *mut c_void,
    buf: *mut QueuedEvent,
    cap: i32,
) -> i32 {
    if buf.is_null() || cap <= 0 {
        return 0;
    }
    let mut state = STATE.lock().expect("rdu state");
    let n = state.queue.count.min(cap as usize);
    for i in 0..n {
        let idx = (state.queue.head + i) % QUEUE_CAP;
        unsafe {
            *buf.add(i) = state.queue.events[idx];
        }
    }
    state.queue.head = (state.queue.head + n) % QUEUE_CAP;
    state.queue.count -= n;
    n as i32
}
