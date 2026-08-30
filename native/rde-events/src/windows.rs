//! Win32 backend. Client coordinates are already top-left, and they are
//! reported unscaled: `deno desktop` sizes a `BrowserWindow` in device pixels
//! (a 640x480 window is 640x480 physical even at 150% scale, and `getSize()`
//! agrees), so the content view's own pixels *are* its logical pixels here.
//! Do not divide by `GetDpiForWindow` — that would put `clientX` / `clientY`
//! in a different space from `getSize()` and from the drawing surface.
//!
//! Input is captured with a thread-local `WH_GETMESSAGE` hook on the thread
//! that owns the window, which mirrors the macOS local event monitor: the
//! window procedure is left untouched and messages still reach winit.

use std::ffi::{c_void, CStr};
use std::os::raw::c_char;
use std::ptr;
use std::sync::Mutex;

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
    GetAsyncKeyState, GetKeyState, GetKeyboardLayout, GetKeyboardState, MapVirtualKeyW,
    ToUnicodeEx, MAPVK_VSC_TO_VK_EX, VK_CONTROL, VK_LBUTTON, VK_LCONTROL, VK_LMENU, VK_LSHIFT,
    VK_LWIN, VK_MBUTTON, VK_MENU, VK_RBUTTON, VK_RCONTROL, VK_RMENU, VK_RWIN, VK_SHIFT,
    VK_XBUTTON1, VK_XBUTTON2,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, EnumWindows, GetAncestor, GetClientRect, GetCursorPos, GetForegroundWindow,
    GetMessageExtraInfo, GetSystemMetrics, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId,
    IsChild, IsWindow, IsWindowVisible, SetWindowsHookExW, UnhookWindowsHookEx, WindowFromPoint,
    GA_ROOT,
    HHOOK, MSG, PM_REMOVE, SM_SWAPBUTTON, WHEEL_DELTA, WH_GETMESSAGE, WM_KEYDOWN, WM_KEYUP,
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

struct State {
    queue: Queue,
    /// Attached `HWND`, kept as `isize` so `State` stays `Send`.
    attached: isize,
    hook: isize,
    hook_thread: u32,
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
});

fn hwnd_from_ptr(ptr: *mut c_void) -> Option<HWND> {
    if ptr.is_null() {
        None
    } else {
        Some(ptr as HWND)
    }
}

fn attached_hwnd() -> Option<HWND> {
    let handle = STATE.lock().expect("rde state").attached;
    if handle == 0 {
        None
    } else {
        Some(handle as HWND)
    }
}

fn key_down(vk: i32) -> bool {
    unsafe { (GetKeyState(vk) as u16) & 0x8000 != 0 }
}

fn async_key_down(vk: i32) -> bool {
    unsafe { (GetAsyncKeyState(vk) as u16) & 0x8000 != 0 }
}

fn current_modifiers() -> u32 {
    let mut m = 0;
    if key_down(VK_SHIFT as i32) {
        m |= MOD_SHIFT;
    }
    if key_down(VK_CONTROL as i32) {
        m |= MOD_CTRL;
    }
    if key_down(VK_MENU as i32) {
        m |= MOD_ALT;
    }
    if key_down(VK_LWIN as i32) || key_down(VK_RWIN as i32) {
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
    if key_down(VK_MENU as i32) {
        m |= MOD_ALT;
    }
    if key_down(VK_LWIN as i32) || key_down(VK_RWIN as i32) {
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

fn push(state: &mut State, ev: QueuedEvent) {
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

/// Translate one posted message into a queued event, if it is input.
fn handle_message(msg: &MSG) {
    let Some(hwnd) = attached_hwnd() else {
        return;
    };
    if !message_is_ours(hwnd, msg.hwnd) {
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
            ev.click_count = 1;
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
            ev.type_ = if msg.message == WM_KEYDOWN || msg.message == WM_SYSKEYDOWN {
                EV_KEY_DOWN
            } else {
                EV_KEY_UP
            };
            let vk = loword(msg.wParam) as u32;
            ev.key_code = resolve_side(vk, msg.lParam);
            ev.buttons = current_buttons();
            ev.modifiers = current_modifiers();
            if let Some(text) = characters(vk, msg.lParam) {
                set_key_text(&mut ev, &text);
            }
            // Key messages carry no cursor position; use the live cursor.
            let mut cursor = POINT { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut cursor) } != 0 {
                let mapped = map_screen(hwnd, cursor);
                ev.client_x = mapped.client_x;
                ev.client_y = mapped.client_y;
                ev.screen_x = mapped.screen_x;
                ev.screen_y = mapped.screen_y;
            }
            push(&mut STATE.lock().expect("rde state"), ev);
            return;
        }
        _ => return,
    }

    let mapped = map_screen(hwnd, screen);
    ev.client_x = mapped.client_x;
    ev.client_y = mapped.client_y;
    ev.screen_x = mapped.screen_x;
    ev.screen_y = mapped.screen_y;
    push(&mut STATE.lock().expect("rde state"), ev);
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // Only look at messages that are really being removed from the queue; a
    // PeekMessage without PM_REMOVE would otherwise report them twice.
    if code >= 0 && wparam as u32 == PM_REMOVE && !(lparam as *const MSG).is_null() {
        handle_message(unsafe { &*(lparam as *const MSG) });
    }
    let hook = STATE.lock().expect("rde state").hook as HHOOK;
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
pub extern "C" fn rde_abi_version() -> i32 {
    ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn rde_find_window(utf8_title: *const c_char) -> *mut c_void {
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
pub extern "C" fn rde_find_front_window() -> *mut c_void {
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
pub extern "C" fn rde_attach(view_ptr: *mut c_void) -> i32 {
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
    let mut state = STATE.lock().expect("rde state");
    state.attached = hwnd as isize;
    state.queue.head = 0;
    state.queue.count = 0;
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
pub extern "C" fn rde_detach(view_ptr: *mut c_void) {
    let mut state = STATE.lock().expect("rde state");
    if !view_ptr.is_null() && state.attached != view_ptr as isize {
        return;
    }
    state.attached = 0;
    state.queue.head = 0;
    state.queue.count = 0;
    remove_hook(&mut state);
}

#[no_mangle]
pub unsafe extern "C" fn rde_snapshot(view_ptr: *mut c_void, out: *mut Snapshot) -> i32 {
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

    let in_bounds = mapped.client_x >= 0.0
        && mapped.client_y >= 0.0
        && mapped.client_x < width
        && mapped.client_y < height;
    // Another window on top of ours means the pointer is not over the view.
    let under_cursor = unsafe { WindowFromPoint(cursor) };
    let unobstructed = !under_cursor.is_null()
        && (under_cursor == hwnd || unsafe { IsChild(hwnd, under_cursor) != 0 });

    let foreground = unsafe { GetForegroundWindow() };
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let focused = !foreground.is_null()
        && (foreground == hwnd || foreground == root || unsafe { IsChild(foreground, hwnd) != 0 });

    let mut snap = Snapshot {
        flags: FLAG_VALID
            | if in_bounds && unobstructed {
                FLAG_INSIDE
            } else {
                0
            }
            | if focused { FLAG_FOCUSED } else { 0 },
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
pub unsafe extern "C" fn rde_poll_events(
    _view_ptr: *mut c_void,
    buf: *mut QueuedEvent,
    cap: i32,
) -> i32 {
    if buf.is_null() || cap <= 0 {
        return 0;
    }
    let mut state = STATE.lock().expect("rde state");
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
