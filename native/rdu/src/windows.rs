//! Win32 backend. Client pixels are unscaled (same space as `getSize()`); do
//! not divide by `GetDpiForWindow`. Thread-local `WH_GETMESSAGE` plus
//! `RIDEV_INPUTSINK` so WebView2 still delivers wheel and keys. `push` drops
//! a duplicate from both paths.

use std::ffi::{c_void, CStr};
use std::mem::size_of;
use std::os::raw::c_char;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
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
use windows_sys::Win32::UI::Input::Ime::{
    ImmGetCompositionStringW, ImmGetContext, ImmReleaseContext, GCS_COMPSTR,
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
    WM_MBUTTONUP, WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONDBLCLK, WM_RBUTTONDOWN,
    WM_RBUTTONUP,
    WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDBLCLK, WM_XBUTTONDOWN, WM_XBUTTONUP, XBUTTON1,
};

use crate::abi::{
    Chrome, QueuedEvent, Snapshot, ABI_VERSION, EV_COMPOSITION_END, EV_COMPOSITION_START,
    EV_COMPOSITION_UPDATE, EV_KEY_DOWN, EV_KEY_UP, EV_POINTER_DOWN, EV_POINTER_UP, EV_WHEEL,
    FLAG_FOCUSED, FLAG_INSIDE, FLAG_VALID, KEY_BYTES, MOD_ALT, MOD_CAPS, MOD_COMPOSING, MOD_CTRL,
    MOD_META, MOD_REPEAT, MOD_SHIFT, PTR_MOUSE, PTR_PEN, QUEUE_CAP,
};

/// One wheel notch in CSS pixels. Same value the X11 backend reports.
const WHEEL_STEP: f32 = 16.0;

/// `windows-sys` files this under `Win32_UI_Controls`, a feature this crate
/// does not otherwise need.
const WM_MOUSELEAVE: u32 = 0x02A3;

/// `GetMessageExtraInfo` signature for pen / touch synthesized mouse input.
const PEN_SIGNATURE: usize = 0xFF51_5700;
const PEN_SIGNATURE_MASK: usize = 0xFFFF_FF00;

struct Queue {
    events: [QueuedEvent; QUEUE_CAP],
    head: usize,
    count: usize,
}

/// Drops an event both raw input and a legacy `WM_*` reported.
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

/// Last press per button. Release reports the same `count` (`dblclick` is on up).
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

const BUTTONS: usize = 5;

struct State {
    queue: Queue,
    attached: isize,
    hook: isize,
    hook_thread: u32,
    raw_input: bool,
    recent: [Recent; RECENT_CAP],
    recent_n: usize,
    clicks: [Click; BUTTONS],
    held: u32,
    keys_down: [u64; 4],
    composing: bool,
    marked: [u8; KEY_BYTES],
    marked_len: u32,
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
    keys_down: [0; 4],
    composing: false,
    marked: [0; KEY_BYTES],
    marked_len: 0,
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

/// Caps Lock toggle. No async form; this is queue-synchronized.
fn key_toggled(vk: i32) -> bool {
    unsafe { GetKeyState(vk) & 1 != 0 }
}

fn async_key_down(vk: i32) -> bool {
    unsafe { (GetAsyncKeyState(vk) as u16) & 0x8000 != 0 }
}

/// Live modifiers via `GetAsyncKeyState` (`GetKeyState` lags raw input).
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
    if key_toggled(VK_CAPITAL as i32) {
        m |= MOD_CAPS;
    }
    m
}

fn buttons_swapped() -> bool {
    unsafe { GetSystemMetrics(SM_SWAPBUTTON) != 0 }
}

/// Live `buttons`. `VK_LBUTTON` is physical; swap back to match WM_*.
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
    if key_toggled(VK_CAPITAL as i32) {
        m |= MOD_CAPS;
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

/// Pen/touch signature from the previous message's extra info (no `WM_POINTER`).
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

/// Queue unless raw input and a legacy message just reported the same event.
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
    crate::wakeup::notify();
}

fn message_is_ours(hwnd: HWND, msg_hwnd: HWND) -> bool {
    if msg_hwnd.is_null() {
        return false;
    }
    msg_hwnd == hwnd || unsafe { IsChild(hwnd, msg_hwnd) != 0 }
}

fn cursor_is_over(hwnd: HWND, cursor: POINT, mapped: &Mapped, width: f32, height: f32) -> bool {
    let in_bounds = mapped.client_x >= 0.0
        && mapped.client_y >= 0.0
        && mapped.client_x < width
        && mapped.client_y < height;
    if !in_bounds {
        return false;
    }
    // WebView2's child surface still counts as ours.
    let under_cursor = unsafe { WindowFromPoint(cursor) };
    !under_cursor.is_null()
        && (under_cursor == hwnd || unsafe { IsChild(hwnd, under_cursor) != 0 })
}

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

/// Focus includes WebView2's owned popups.
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

fn register_raw_input(hwnd: HWND) -> bool {
    set_raw_devices(hwnd, RIDEV_INPUTSINK)
}

fn unregister_raw_input() {
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
    if read == u32::MAX {
        None
    } else {
        Some(data)
    }
}

fn raw_dom_button(physical_left: bool) -> u32 {
    if physical_left != buttons_swapped() {
        0
    } else {
        2
    }
}

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

fn released_click_count(state: &State, button: u32) -> u32 {
    state
        .clicks
        .get(button as usize)
        .map_or(1, |track| track.count)
}

fn remember_click(state: &mut State, button: u32, count: u32) {
    if let Some(track) = state.clicks.get_mut(button as usize) {
        track.count = count;
    }
}

/// Movement queues nothing, so it wakes the session itself. Runs on the host's
/// message thread at the mouse's report rate: throttle before the hit test.
fn notify_move(hwnd: HWND) {
    const INTERVAL_MS: u64 = 4;
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    static LAST_MS: AtomicU64 = AtomicU64::new(0);
    static INSIDE: AtomicBool = AtomicBool::new(false);

    let now = EPOCH.get_or_init(Instant::now).elapsed().as_millis() as u64;
    if now.wrapping_sub(LAST_MS.load(Ordering::Relaxed)) < INTERVAL_MS {
        return;
    }
    LAST_MS.store(now, Ordering::Relaxed);

    let inside = cursor_over_view(hwnd).is_some();
    // The move that leaves still has to wake, or `pointerout` waits a frame.
    if INSIDE.swap(inside, Ordering::Relaxed) || inside {
        crate::wakeup::notify();
    }
}

fn handle_raw_mouse(hwnd: HWND, mouse: &RAWMOUSE) {
    let flags = unsafe { mouse.Anonymous.Anonymous.usButtonFlags } as u32;
    if flags == 0 {
        notify_move(hwnd);
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

fn characters(vk: u32, lparam: LPARAM) -> Option<String> {
    let mut keys = [0u8; 256];
    if unsafe { GetKeyboardState(keys.as_mut_ptr()) } == 0 {
        return None;
    }
    // Refresh physical modifiers; Caps Lock has no async form.
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
    // Bit 2 leaves kernel keyboard state alone (dead keys).
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
    // Control chars are not a `KeyboardEvent.key`.
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

/// IMM32 composition string, or `None` when idle / empty.
fn composition_text(hwnd: HWND) -> Option<String> {
    let imc = unsafe { ImmGetContext(hwnd) };
    if imc.is_null() {
        return None;
    }
    // Idle and empty composition both answer 0.
    let bytes = unsafe { ImmGetCompositionStringW(imc, GCS_COMPSTR, ptr::null_mut(), 0) };
    let text = if bytes <= 0 {
        None
    } else {
        let mut buf = vec![0u16; (bytes as usize) / 2 + 1];
        let written = unsafe {
            ImmGetCompositionStringW(
                imc,
                GCS_COMPSTR,
                buf.as_mut_ptr().cast(),
                (buf.len() * 2) as u32,
            )
        };
        let units = if written > 0 {
            (written as usize / 2).min(buf.len())
        } else {
            0
        };
        Some(String::from_utf16_lossy(&buf[..units]))
    };
    unsafe { ImmReleaseContext(hwnd, imc) };
    text
}

/// Diff IMM32 state. `WM_IME_*` goes to the IME's window, not ours.
fn emit_composition(hwnd: HWND) {
    let now = composition_text(hwnd);
    let mut state = STATE.lock().expect("rdu state");
    let was = state.composing;
    let prev = stored_marked(&state);
    let is = now.is_some();
    let text = now.unwrap_or_default();
    state.composing = is;
    store_marked(&mut state, &text);

    if !was && is {
        push_composition(&mut state, hwnd, EV_COMPOSITION_START, &text);
        if !text.is_empty() {
            push_composition(&mut state, hwnd, EV_COMPOSITION_UPDATE, &text);
        }
    } else if was && is && text != prev {
        push_composition(&mut state, hwnd, EV_COMPOSITION_UPDATE, &text);
    } else if was && !is {
        push_composition(&mut state, hwnd, EV_COMPOSITION_END, &prev);
    }
}

fn push_composition(state: &mut State, hwnd: HWND, type_: u32, data: &str) {
    let mut ev = QueuedEvent::empty();
    ev.type_ = type_;
    ev.pointer_type = PTR_MOUSE;
    ev.buttons = current_buttons();
    ev.modifiers = current_modifiers();
    ev.pressure = -1.0;
    set_key_text(&mut ev, data);
    let mut cursor = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } != 0 {
        let mapped = map_screen(hwnd, cursor);
        ev.client_x = mapped.client_x;
        ev.client_y = mapped.client_y;
        ev.screen_x = mapped.screen_x;
        ev.screen_y = mapped.screen_y;
    }
    push(state, ev);
}

fn store_marked(state: &mut State, text: &str) {
    let bytes = text.as_bytes();
    let mut n = bytes.len().min(KEY_BYTES);
    while n > 0 && !text.is_char_boundary(n) {
        n -= 1;
    }
    state.marked[..n].copy_from_slice(&bytes[..n]);
    state.marked_len = n as u32;
}

fn stored_marked(state: &State) -> String {
    String::from_utf8_lossy(&state.marked[..state.marked_len as usize]).into_owned()
}

fn track_key(state: &mut State, vk: u32, down: bool) -> bool {
    let Some(word) = state.keys_down.get_mut((vk as usize) / 64) else {
        return false;
    };
    let bit = 1u64 << (vk % 64);
    let was = *word & bit != 0;
    if down {
        *word |= bit;
    } else {
        *word &= !bit;
    }
    down && was
}

fn push_key(hwnd: HWND, vk: u32, lparam: LPARAM, down: bool) {
    let mut ev = QueuedEvent::empty();
    ev.type_ = if down { EV_KEY_DOWN } else { EV_KEY_UP };
    ev.pointer_type = PTR_MOUSE;
    ev.key_code = resolve_side(vk, lparam);
    ev.buttons = current_buttons();
    ev.modifiers = current_modifiers();
    if composition_text(hwnd).is_some() {
        ev.modifiers |= MOD_COMPOSING;
    }
    if let Some(text) = characters(vk, lparam) {
        set_key_text(&mut ev, &text);
    }
    let mut cursor = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } != 0 {
        let mapped = map_screen(hwnd, cursor);
        ev.client_x = mapped.client_x;
        ev.client_y = mapped.client_y;
        ev.screen_x = mapped.screen_x;
        ev.screen_y = mapped.screen_y;
    }
    let mut state = STATE.lock().expect("rdu state");
    if track_key(&mut state, ev.key_code, down) {
        ev.modifiers |= MOD_REPEAT;
    }
    push(&mut state, ev);
}

fn handle_message(msg: &MSG) {
    let Some(hwnd) = attached_hwnd() else {
        return;
    };
    if !message_is_ours(hwnd, msg.hwnd) {
        return;
    }

    if msg.message == WM_INPUT {
        handle_raw_input(hwnd, msg.lParam as HRAWINPUT);
        return;
    }
    // Raw input covers hosts that keep the pointer in another process.
    // `WM_MOUSEMOVE` stops at the edge, so the leave needs its own message.
    if msg.message == WM_MOUSEMOVE || msg.message == WM_MOUSELEAVE {
        notify_move(hwnd);
        return;
    }

    let mut ev = QueuedEvent::empty();
    ev.pointer_type = PTR_MOUSE;

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
    // PM_REMOVE only; PeekMessage without it would report twice.
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
    state.keys_down = [0; 4];
    state.composing = false;
    state.marked_len = 0;
    state.raw_input = register_raw_input(hwnd);
    if state.hook != 0 && state.hook_thread == thread {
        return 1;
    }
    remove_hook(&mut state);
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
    state.keys_down = [0; 4];
    state.composing = false;
    state.marked_len = 0;
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
    if let Some(hwnd) = attached_hwnd() {
        emit_composition(hwnd);
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
