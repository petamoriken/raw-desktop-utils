//! Wayland backend. Wraps the app's `wl_display` on a dedicated queue.
//! Cannot see other clients — pass `wl_surface*` / `displayHandle`.
//! Debian bookworm libwayland is 1.21; prefer `rdu_set_display`.

use std::collections::VecDeque;
use std::ffi::c_void;
use std::os::raw::c_char;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use wayland_backend::sys::client::Backend;
use wayland_client::protocol::wl_keyboard::{self, WlKeyboard};
use wayland_client::protocol::wl_pointer::{self, WlPointer};
use wayland_client::protocol::wl_registry::{self, WlRegistry};
use wayland_client::protocol::wl_seat::{self, WlSeat};
use wayland_client::protocol::wl_surface::WlSurface;
use wayland_client::{Connection, Dispatch, EventQueue, Proxy, QueueHandle};
use wayland_sys::client::*;
use wayland_sys::ffi_dispatch;

use crate::abi::{
    QueuedEvent, Snapshot, EV_KEY_DOWN, EV_KEY_UP, EV_POINTER_DOWN, EV_POINTER_UP, EV_WHEEL,
    FLAG_FOCUSED, FLAG_INSIDE, FLAG_VALID, MOD_ALT, MOD_CAPS, MOD_CTRL, MOD_META, MOD_SHIFT,
    PTR_MOUSE, QUEUE_CAP,
};

const BTN_LEFT: u32 = 0x110;
const BTN_RIGHT: u32 = 0x111;
const BTN_MIDDLE: u32 = 0x112;
const BTN_SIDE: u32 = 0x113;
const BTN_EXTRA: u32 = 0x114;

type GetDisplayFn = unsafe extern "C" fn(*mut wl_proxy) -> *mut wl_display;

struct Input {
    attached: *mut c_void,
    attached_id: u32,
    pointer_id: u32,
    keyboard_id: u32,
    x: f64,
    y: f64,
    buttons: u32,
    modifiers: u32,
    events: VecDeque<QueuedEvent>,
    seat: Option<WlSeat>,
    pointer: Option<WlPointer>,
    keyboard: Option<WlKeyboard>,
}

struct Wayland {
    conn: Connection,
    queue: EventQueue<Input>,
    _registry: WlRegistry,
    input: Input,
}

unsafe impl Send for Wayland {}

static STATE: Mutex<Option<Wayland>> = Mutex::new(None);
static FOREIGN_DISPLAY: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());

fn button_from_linux(code: u32) -> Option<(u32, u32)> {
    match code {
        BTN_LEFT => Some((0, 1)),
        BTN_RIGHT => Some((2, 2)),
        BTN_MIDDLE => Some((1, 4)),
        BTN_SIDE => Some((3, 8)),
        BTN_EXTRA => Some((4, 16)),
        _ => None,
    }
}

/// xkb: Shift 0, Lock 1, Control 2, Mod1 3, Mod4 6. Caps Lock is locked, not depressed.
fn mods_from_xkb(depressed: u32, locked: u32) -> u32 {
    let mut m = 0;
    if depressed & (1 << 0) != 0 {
        m |= MOD_SHIFT;
    }
    if depressed & (1 << 2) != 0 {
        m |= MOD_CTRL;
    }
    if depressed & (1 << 3) != 0 {
        m |= MOD_ALT;
    }
    if depressed & (1 << 6) != 0 {
        m |= MOD_META;
    }
    if locked & (1 << 1) != 0 {
        m |= MOD_CAPS;
    }
    m
}

fn proxy_protocol_id(proxy: *mut wl_proxy) -> u32 {
    if !is_lib_available() || proxy.is_null() {
        return 0;
    }
    unsafe { ffi_dispatch!(wayland_client_handle(), wl_proxy_get_id, proxy) }
}

fn surface_protocol_id(surface: &WlSurface) -> u32 {
    surface.id().protocol_id()
}

fn fill_pointer(input: &Input, ev: &mut QueuedEvent) {
    ev.client_x = input.x as f32;
    ev.client_y = input.y as f32;
    ev.screen_x = input.x as f32;
    ev.screen_y = input.y as f32;
    ev.buttons = input.buttons;
    ev.modifiers = input.modifiers;
    ev.pointer_type = PTR_MOUSE;
}

fn push(input: &mut Input, ev: QueuedEvent) {
    if input.events.len() == QUEUE_CAP {
        input.events.pop_front();
    }
    input.events.push_back(ev);
    crate::wakeup::notify();
}

fn start_pump() {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = thread::Builder::new()
        .name("rdu-wayland".into())
        .spawn(|| loop {
            thread::sleep(Duration::from_millis(8));
            dispatch_state();
            let pending = STATE
                .lock()
                .ok()
                .and_then(|guard| guard.as_ref().map(|wl| !wl.input.events.is_empty()))
                .unwrap_or(false);
            if pending {
                crate::wakeup::notify();
            }
        });
}

impl Dispatch<WlRegistry, ()> for Input {
    fn event(
        state: &mut Self,
        registry: &WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        if let wl_registry::Event::Global {
            name,
            interface,
            version,
        } = event
        {
            if interface == "wl_seat" && state.seat.is_none() {
                state.seat = Some(registry.bind::<WlSeat, _, _>(name, version.min(5), qh, ()));
            }
        }
    }
}

impl Dispatch<WlSeat, ()> for Input {
    fn event(
        state: &mut Self,
        seat: &WlSeat,
        event: wl_seat::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        if let wl_seat::Event::Capabilities { capabilities } = event {
            let caps = capabilities
                .into_result()
                .unwrap_or(wl_seat::Capability::empty());
            if caps.contains(wl_seat::Capability::Pointer) && state.pointer.is_none() {
                state.pointer = Some(seat.get_pointer(qh, ()));
            }
            if caps.contains(wl_seat::Capability::Keyboard) && state.keyboard.is_none() {
                state.keyboard = Some(seat.get_keyboard(qh, ()));
            }
        }
    }
}

impl Dispatch<WlPointer, ()> for Input {
    fn event(
        state: &mut Self,
        _: &WlPointer,
        event: wl_pointer::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            wl_pointer::Event::Enter {
                surface,
                surface_x,
                surface_y,
                ..
            } => {
                state.pointer_id = surface_protocol_id(&surface);
                state.x = surface_x;
                state.y = surface_y;
                crate::wakeup::notify();
            }
            wl_pointer::Event::Leave { .. } => {
                state.pointer_id = 0;
                crate::wakeup::notify();
            }
            wl_pointer::Event::Motion {
                surface_x,
                surface_y,
                ..
            } => {
                state.x = surface_x;
                state.y = surface_y;
                crate::wakeup::notify();
            }
            wl_pointer::Event::Button {
                button, state: btn, ..
            } => {
                let Some((dom, bit)) = button_from_linux(button) else {
                    return;
                };
                let pressed = matches!(btn.into_result(), Ok(wl_pointer::ButtonState::Pressed));
                if pressed {
                    state.buttons |= bit;
                } else {
                    state.buttons &= !bit;
                }
                let mut ev = QueuedEvent::empty();
                ev.type_ = if pressed {
                    EV_POINTER_DOWN
                } else {
                    EV_POINTER_UP
                };
                ev.button = dom;
                ev.click_count = 1;
                fill_pointer(state, &mut ev);
                push(state, ev);
            }
            wl_pointer::Event::Axis { axis, value, .. } => {
                let mut ev = QueuedEvent::empty();
                ev.type_ = EV_WHEEL;
                match axis.into_result() {
                    Ok(wl_pointer::Axis::VerticalScroll) => ev.delta_y = value as f32,
                    Ok(wl_pointer::Axis::HorizontalScroll) => ev.delta_x = value as f32,
                    _ => {}
                }
                fill_pointer(state, &mut ev);
                push(state, ev);
            }
            _ => {}
        }
    }
}

impl Dispatch<WlKeyboard, ()> for Input {
    fn event(
        state: &mut Self,
        _: &WlKeyboard,
        event: wl_keyboard::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            wl_keyboard::Event::Enter { surface, .. } => {
                state.keyboard_id = surface_protocol_id(&surface);
            }
            wl_keyboard::Event::Leave { .. } => {
                state.keyboard_id = 0;
            }
            wl_keyboard::Event::Key { key, state: ks, .. } => {
                let pressed = matches!(ks.into_result(), Ok(wl_keyboard::KeyState::Pressed));
                let mut ev = QueuedEvent::empty();
                ev.type_ = if pressed { EV_KEY_DOWN } else { EV_KEY_UP };
                ev.key_code = key;
                fill_pointer(state, &mut ev);
                push(state, ev);
            }
            wl_keyboard::Event::Modifiers {
                mods_depressed,
                mods_locked,
                ..
            } => {
                state.modifiers = mods_from_xkb(mods_depressed, mods_locked);
            }
            _ => {}
        }
    }
}

impl Dispatch<WlSurface, ()> for Input {
    fn event(
        _: &mut Self,
        _: &WlSurface,
        _: wayland_client::protocol::wl_surface::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

fn lookup_wl_proxy_get_display() -> Option<GetDisplayFn> {
    static FN: OnceLock<Option<GetDisplayFn>> = OnceLock::new();
    *FN.get_or_init(|| unsafe {
        extern "C" {
            fn dlopen(filename: *const c_char, flags: i32) -> *mut c_void;
            fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
        }
        const RTLD_LAZY: i32 = 1;
        const RTLD_NOLOAD: i32 = 4;
        let libs = [
            b"libwayland-client.so.0\0".as_ptr().cast::<c_char>(),
            b"libwayland-client.so\0".as_ptr().cast::<c_char>(),
        ];
        for lib_name in libs {
            let handle = dlopen(lib_name, RTLD_LAZY | RTLD_NOLOAD);
            if handle.is_null() {
                continue;
            }
            let sym = dlsym(handle, b"wl_proxy_get_display\0".as_ptr().cast());
            if !sym.is_null() {
                return Some(std::mem::transmute::<_, GetDisplayFn>(sym));
            }
        }
        None
    })
}

fn display_from_proxy_layout(proxy: *mut wl_proxy) -> *mut wl_display {
    let ptr_size = std::mem::size_of::<*mut c_void>();
    let offset = ptr_size * 2
        + std::mem::size_of::<u32>()
        + if cfg!(target_pointer_width = "64") {
            4
        } else {
            0
        };
    unsafe { ptr::read(proxy.cast::<u8>().add(offset).cast::<*mut wl_display>()) }
}

fn display_from_surface(surface: *mut wl_proxy) -> *mut wl_display {
    if surface.is_null() {
        return ptr::null_mut();
    }
    if let Some(get_display) = lookup_wl_proxy_get_display() {
        return unsafe { get_display(surface) };
    }
    display_from_proxy_layout(surface)
}

fn resolve_display(surface: *mut c_void) -> *mut wl_display {
    let from_js = FOREIGN_DISPLAY.load(Ordering::SeqCst);
    if !from_js.is_null() {
        return from_js.cast();
    }
    display_from_surface(surface.cast())
}

fn setup(surface: *mut c_void) -> bool {
    if !is_lib_available() {
        return false;
    }
    let display_ptr = resolve_display(surface);
    if display_ptr.is_null() {
        return false;
    }
    // Guest display: no close on detach, no roundtrip (races winit).
    let backend = unsafe { Backend::from_foreign_display(display_ptr.cast()) };
    let conn = Connection::from_backend(backend);
    let mut queue = conn.new_event_queue();
    let qh = queue.handle();
    let registry = conn.display().get_registry(&qh, ());
    let _ = conn.flush();
    let mut input = Input {
        attached: surface,
        attached_id: proxy_protocol_id(surface.cast()),
        pointer_id: 0,
        keyboard_id: 0,
        x: 0.0,
        y: 0.0,
        buttons: 0,
        modifiers: 0,
        events: VecDeque::new(),
        seat: None,
        pointer: None,
        keyboard: None,
    };
    let _ = queue.dispatch_pending(&mut input);
    *STATE.lock().expect("rdu wayland") = Some(Wayland {
        conn,
        queue,
        _registry: registry,
        input,
    });
    start_pump();
    true
}

fn dispatch_state() {
    let mut guard = STATE.lock().expect("rdu wayland");
    let Some(wl) = guard.as_mut() else {
        return;
    };
    let _ = wl.conn.flush();
    let _ = wl.queue.dispatch_pending(&mut wl.input);
}

pub(crate) fn set_display(display: *mut c_void) {
    FOREIGN_DISPLAY.store(display, Ordering::SeqCst);
}

pub(crate) fn prefer_wayland() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty())
}

/// X11 XIDs fit in 32 bits; Wayland surfaces are real pointers.
pub(crate) fn looks_like_wayland_surface(ptr: *mut c_void) -> bool {
    let n = ptr as usize;
    n > u32::MAX as usize
}

pub(crate) unsafe fn find_window(_utf8_title: *const c_char) -> *mut c_void {
    ptr::null_mut()
}

pub(crate) fn find_front_window() -> *mut c_void {
    STATE
        .lock()
        .expect("rdu wayland")
        .as_ref()
        .map(|wl| wl.input.attached)
        .unwrap_or(ptr::null_mut())
}

pub(crate) fn attach(view_ptr: *mut c_void) -> i32 {
    if view_ptr.is_null() {
        return 0;
    }
    i32::from(setup(view_ptr))
}

pub(crate) fn detach(view_ptr: *mut c_void) {
    let mut guard = STATE.lock().expect("rdu wayland");
    if guard
        .as_ref()
        .is_some_and(|wl| wl.input.attached == view_ptr || view_ptr.is_null())
    {
        *guard = None;
    }
}

pub(crate) unsafe fn snapshot(view_ptr: *mut c_void, out: *mut Snapshot) -> i32 {
    if out.is_null() {
        return 0;
    }
    dispatch_state();
    let guard = STATE.lock().expect("rdu wayland");
    let Some(wl) = guard.as_ref() else {
        unsafe {
            *out = Snapshot::empty();
        }
        return 0;
    };
    if view_ptr.is_null() || wl.input.attached.is_null() {
        unsafe {
            *out = Snapshot::empty();
        }
        return 0;
    }
    let inside = wl.input.pointer_id != 0 && wl.input.pointer_id == wl.input.attached_id;
    let focused = wl.input.keyboard_id != 0 && wl.input.keyboard_id == wl.input.attached_id;
    unsafe {
        *out = Snapshot {
            flags: FLAG_VALID
                | if inside { FLAG_INSIDE } else { 0 }
                | if focused { FLAG_FOCUSED } else { 0 },
            client_x: wl.input.x as f32,
            client_y: wl.input.y as f32,
            screen_x: wl.input.x as f32,
            screen_y: wl.input.y as f32,
            buttons: wl.input.buttons,
            modifiers: wl.input.modifiers,
            pressure: if wl.input.buttons != 0 { 0.5 } else { 0.0 },
            tilt_x: 0.0,
            tilt_y: 0.0,
            twist: 0.0,
            pointer_type: PTR_MOUSE,
            device_pixel_ratio: 1.0,
            window_x: 0.0,
            window_y: 0.0,
            inner_w: 0.0,
            inner_h: 0.0,
            outer_w: 0.0,
            outer_h: 0.0,
            screen_w: 0.0,
            screen_h: 0.0,
            avail_x: 0.0,
            avail_y: 0.0,
            avail_w: 0.0,
            avail_h: 0.0,
        };
    }
    1
}

pub(crate) unsafe fn poll_events(
    _view_ptr: *mut c_void,
    buf: *mut QueuedEvent,
    cap: i32,
) -> i32 {
    if buf.is_null() || cap <= 0 {
        return 0;
    }
    dispatch_state();
    let mut guard = STATE.lock().expect("rdu wayland");
    let Some(wl) = guard.as_mut() else {
        return 0;
    };
    let n = wl.input.events.len().min(cap as usize);
    for i in 0..n {
        unsafe {
            *buf.add(i) = wl.input.events.pop_front().unwrap();
        }
    }
    n as i32
}
