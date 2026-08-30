//! AppKit backend. Coordinates stay in screen space with a top-left origin.

use std::ffi::{c_void, CStr};
use std::ptr::{self, NonNull};
use std::sync::atomic::{AtomicI32, AtomicPtr, Ordering};
use std::sync::{Arc, Mutex};

use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{ClassType, MainThreadMarker};
use objc2_app_kit::{
    NSApplication, NSEvent, NSEventMask, NSEventModifierFlags, NSEventSubtype, NSEventType,
    NSScreen, NSView, NSWindow,
};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSThread};

use crate::abi::{
    QueuedEvent, Snapshot, ABI_VERSION, EV_KEY_DOWN, EV_KEY_UP, EV_POINTER_DOWN, EV_POINTER_UP,
    EV_WHEEL, FLAG_FOCUSED, FLAG_INSIDE, FLAG_VALID, KEY_BYTES, MOD_ALT, MOD_CTRL, MOD_META,
    MOD_SHIFT, PTR_MOUSE, PTR_PEN, QUEUE_CAP,
};

struct Queue {
    events: [QueuedEvent; QUEUE_CAP],
    head: usize,
    count: usize,
}

#[derive(Clone, Copy)]
struct Tablet {
    pressure: f32,
    tilt_x: f32,
    tilt_y: f32,
    twist: f32,
    pointer_type: u32,
}

struct State {
    queue: Queue,
    attached: *mut c_void,
    monitor: Option<Retained<AnyObject>>,
    tablet: Tablet,
}

unsafe impl Send for State {}

static STATE: Mutex<State> = Mutex::new(State {
    queue: Queue {
        events: [QueuedEvent::empty(); QUEUE_CAP],
        head: 0,
        count: 0,
    },
    attached: ptr::null_mut(),
    monitor: None,
    tablet: Tablet {
        pressure: -1.0,
        tilt_x: 0.0,
        tilt_y: 0.0,
        twist: 0.0,
        pointer_type: PTR_MOUSE,
    },
});

extern "C" fn call_once<F: FnOnce()>(ctx: *mut c_void) {
    let work = unsafe { Box::from_raw(ctx.cast::<F>()) };
    work();
}

fn on_main<F: FnOnce()>(work: F) {
    if NSThread::isMainThread_class() || !app_is_running() {
        work();
        return;
    }
    let ctx = Box::into_raw(Box::new(work)).cast();
    unsafe {
        DispatchQueue::main().exec_sync_f(ctx, call_once::<F>);
    }
}

fn app_is_running() -> bool {
    MainThreadMarker::new().is_some_and(|mtm| NSApplication::sharedApplication(mtm).isRunning())
}

fn require_mtm() -> Option<MainThreadMarker> {
    MainThreadMarker::new().or_else(|| {
        if NSThread::isMainThread_class() {
            Some(unsafe { MainThreadMarker::new_unchecked() })
        } else {
            None
        }
    })
}

fn as_view(ptr: *mut c_void) -> Option<Retained<NSView>> {
    if ptr.is_null() {
        return None;
    }
    let obj = unsafe { &*ptr.cast::<AnyObject>() };
    let is_view: bool = unsafe { objc2::msg_send![obj, isKindOfClass: NSView::class()] };
    if is_view {
        return unsafe { Retained::retain(ptr.cast::<NSView>()) };
    }
    let is_window: bool = unsafe { objc2::msg_send![obj, isKindOfClass: NSWindow::class()] };
    if is_window {
        let window = unsafe { &*ptr.cast::<NSWindow>() };
        return window.contentView();
    }
    None
}

fn modifiers(flags: NSEventModifierFlags) -> u32 {
    let mut m = 0;
    if flags.contains(NSEventModifierFlags::Shift) {
        m |= MOD_SHIFT;
    }
    if flags.contains(NSEventModifierFlags::Control) {
        m |= MOD_CTRL;
    }
    if flags.contains(NSEventModifierFlags::Option) {
        m |= MOD_ALT;
    }
    if flags.contains(NSEventModifierFlags::Command) {
        m |= MOD_META;
    }
    m
}

fn dom_buttons(pressed: usize) -> u32 {
    (pressed as u32) & 0x1f
}

fn dom_button(n: isize) -> u32 {
    match n {
        1 => 2,
        2 => 1,
        n if n < 0 => 0,
        n => n as u32,
    }
}

fn pointer_kind(event: &NSEvent) -> u32 {
    let t = event.r#type();
    if t == NSEventType::TabletPoint || t == NSEventType::TabletProximity {
        return PTR_PEN;
    }
    let sub = event.subtype();
    if sub == NSEventSubtype::TabletPoint || sub == NSEventSubtype::TabletProximity {
        return PTR_PEN;
    }
    PTR_MOUSE
}

fn union_rect(a: NSRect, b: NSRect) -> NSRect {
    let min_x = a.min().x.min(b.min().x);
    let min_y = a.min().y.min(b.min().y);
    let max_x = a.max().x.max(b.max().x);
    let max_y = a.max().y.max(b.max().y);
    NSRect::new(
        NSPoint::new(min_x, min_y),
        NSSize::new(max_x - min_x, max_y - min_y),
    )
}

fn rect_contains(rect: NSRect, p: NSPoint) -> bool {
    p.x >= rect.min().x && p.x <= rect.max().x && p.y >= rect.min().y && p.y <= rect.max().y
}

fn desktop_frame(mtm: MainThreadMarker) -> NSRect {
    let mut desktop = NSRect::ZERO;
    for screen in NSScreen::screens(mtm) {
        desktop = union_rect(desktop, screen.frame());
    }
    desktop
}

struct Mapped {
    client_x: f32,
    client_y: f32,
    screen_x: f32,
    screen_y: f32,
    view_w: f32,
    view_h: f32,
    inside: bool,
}

fn map_screen(
    view: &NSView,
    screen: NSPoint,
    require_front: bool,
    mtm: MainThreadMarker,
) -> Option<Mapped> {
    let window = view.window()?;
    let bounds = view.bounds();
    let in_window = view.convertRect_toView(bounds, None);
    let view_on_screen = window.convertRectToScreen(in_window);
    let desktop = desktop_frame(mtm);
    let mut mapped = Mapped {
        screen_x: screen.x as f32,
        screen_y: (desktop.max().y - screen.y) as f32,
        client_x: (screen.x - view_on_screen.min().x) as f32,
        // Stay in screen space. convertPoint / isFlipped on winit views
        // does not agree with window-base Y.
        client_y: (view_on_screen.max().y - screen.y) as f32,
        view_w: view_on_screen.size.width as f32,
        view_h: view_on_screen.size.height as f32,
        inside: rect_contains(view_on_screen, screen),
    };
    if mapped.inside && require_front {
        let front = NSWindow::windowNumberAtPoint_belowWindowWithWindowNumber(screen, 0, mtm);
        if front != window.windowNumber() {
            mapped.inside = false;
        }
    }
    Some(mapped)
}

fn event_screen(event: &NSEvent, mtm: MainThreadMarker) -> NSPoint {
    if let Some(window) = event.window(mtm) {
        return window.convertPointToScreen(event.locationInWindow());
    }
    NSEvent::mouseLocation()
}

fn event_for_attached(event: &NSEvent, view: &NSView, mtm: MainThreadMarker) -> bool {
    let Some(ours) = view.window() else {
        return false;
    };
    if let Some(ev_window) = event.window(mtm) {
        if ev_window == ours {
            return true;
        }
    }
    let t = event.r#type();
    if t == NSEventType::KeyDown || t == NSEventType::KeyUp {
        return ours.isKeyWindow();
    }
    map_screen(view, event_screen(event, mtm), false, mtm).is_some_and(|m| m.inside)
}

fn push(ev: QueuedEvent) {
    let mut state = STATE.lock().expect("rde state");
    let q = &mut state.queue;
    if q.count == QUEUE_CAP {
        q.head = (q.head + 1) % QUEUE_CAP;
        q.count -= 1;
    }
    let tail = (q.head + q.count) % QUEUE_CAP;
    q.events[tail] = ev;
    q.count += 1;
}

fn fill_pointer_fields(event: &NSEvent, ev: &mut QueuedEvent) {
    let mut state = STATE.lock().expect("rde state");
    ev.pointer_type = pointer_kind(event);
    if ev.pointer_type == PTR_PEN {
        ev.pressure = event.pressure();
        let tilt = event.tilt();
        ev.tilt_x = (tilt.x * 90.0) as f32;
        ev.tilt_y = (tilt.y * 90.0) as f32;
        ev.twist = event.rotation() as f32;
        state.tablet = Tablet {
            pressure: ev.pressure,
            tilt_x: ev.tilt_x,
            tilt_y: ev.tilt_y,
            twist: ev.twist,
            pointer_type: PTR_PEN,
        };
    } else {
        ev.pressure = -1.0;
        ev.tilt_x = state.tablet.tilt_x;
        ev.tilt_y = state.tablet.tilt_y;
        ev.twist = state.tablet.twist;
        ev.pointer_type = state.tablet.pointer_type;
    }
}

fn handle_event(event: &NSEvent) {
    let Some(mtm) = require_mtm() else {
        return;
    };
    let attached = STATE.lock().expect("rde state").attached;
    let Some(view) = as_view(attached) else {
        return;
    };
    if !event_for_attached(event, &view, mtm) {
        return;
    }

    let mut ev = QueuedEvent::empty();
    ev.modifiers = modifiers(event.modifierFlags());
    ev.buttons = dom_buttons(NSEvent::pressedMouseButtons());
    ev.click_count = event.clickCount() as u32;
    ev.key_code = event.keyCode() as u32;
    ev.pressure = -1.0;
    if let Some(mapped) = map_screen(&view, event_screen(event, mtm), false, mtm) {
        ev.client_x = mapped.client_x;
        ev.client_y = mapped.client_y;
        ev.screen_x = mapped.screen_x;
        ev.screen_y = mapped.screen_y;
    }

    match event.r#type() {
        NSEventType::LeftMouseDown | NSEventType::RightMouseDown | NSEventType::OtherMouseDown => {
            ev.type_ = EV_POINTER_DOWN;
            ev.button = dom_button(event.buttonNumber());
            fill_pointer_fields(event, &mut ev);
            push(ev);
        }
        NSEventType::LeftMouseUp | NSEventType::RightMouseUp | NSEventType::OtherMouseUp => {
            ev.type_ = EV_POINTER_UP;
            ev.button = dom_button(event.buttonNumber());
            fill_pointer_fields(event, &mut ev);
            push(ev);
        }
        NSEventType::ScrollWheel => {
            ev.type_ = EV_WHEEL;
            if event.hasPreciseScrollingDeltas() {
                ev.delta_x = event.scrollingDeltaX() as f32;
                ev.delta_y = -event.scrollingDeltaY() as f32;
            } else {
                ev.delta_x = (event.scrollingDeltaX() * 16.0) as f32;
                ev.delta_y = (-event.scrollingDeltaY() * 16.0) as f32;
            }
            push(ev);
        }
        NSEventType::KeyDown | NSEventType::KeyUp => {
            ev.type_ = if event.r#type() == NSEventType::KeyDown {
                EV_KEY_DOWN
            } else {
                EV_KEY_UP
            };
            let chars = event
                .charactersIgnoringModifiers()
                .filter(|s| s.length() > 0)
                .or_else(|| event.characters());
            if let Some(chars) = chars {
                let utf8 = chars.to_string();
                let n = utf8.len().min(KEY_BYTES);
                ev.key[..n].copy_from_slice(&utf8.as_bytes()[..n]);
                ev.key_len = n as u32;
            }
            push(ev);
        }
        NSEventType::TabletPoint => fill_pointer_fields(event, &mut ev),
        _ => {}
    }
}

fn install_monitor(state: &mut State) {
    if state.monitor.is_some() {
        return;
    }
    let mask = NSEventMask::LeftMouseDown
        | NSEventMask::LeftMouseUp
        | NSEventMask::RightMouseDown
        | NSEventMask::RightMouseUp
        | NSEventMask::OtherMouseDown
        | NSEventMask::OtherMouseUp
        | NSEventMask::ScrollWheel
        | NSEventMask::KeyDown
        | NSEventMask::KeyUp
        | NSEventMask::TabletPoint;
    let block = RcBlock::new(|event: NonNull<NSEvent>| -> *mut NSEvent {
        handle_event(unsafe { event.as_ref() });
        event.as_ptr()
    });
    state.monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block) };
}

fn remove_monitor(state: &mut State) {
    if let Some(monitor) = state.monitor.take() {
        unsafe { NSEvent::removeMonitor(&monitor) };
    }
}

#[no_mangle]
pub extern "C" fn rde_abi_version() -> i32 {
    ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn rde_find_window(utf8_title: *const i8) -> *mut c_void {
    if utf8_title.is_null() {
        return ptr::null_mut();
    }
    let want = unsafe { CStr::from_ptr(utf8_title) }
        .to_string_lossy()
        .into_owned();
    let result = Arc::new(AtomicPtr::new(ptr::null_mut()));
    let out = result.clone();
    on_main(move || {
        let Some(mtm) = require_mtm() else {
            return;
        };
        let app = NSApplication::sharedApplication(mtm);
        let want = NSString::from_str(&want);
        for window in app.windows() {
            if window.title().isEqualToString(&want) {
                if let Some(view) = window.contentView() {
                    out.store(Retained::as_ptr(&view) as *mut c_void, Ordering::SeqCst);
                }
                break;
            }
        }
    });
    result.load(Ordering::SeqCst)
}

#[no_mangle]
pub extern "C" fn rde_find_front_window() -> *mut c_void {
    let result = Arc::new(AtomicPtr::new(ptr::null_mut()));
    let out = result.clone();
    on_main(move || {
        let Some(mtm) = require_mtm() else {
            return;
        };
        let app = NSApplication::sharedApplication(mtm);
        let window = app
            .keyWindow()
            .or_else(|| app.mainWindow())
            .or_else(|| app.windows().firstObject());
        if let Some(window) = window {
            if let Some(view) = window.contentView() {
                out.store(Retained::as_ptr(&view) as *mut c_void, Ordering::SeqCst);
            }
        }
    });
    result.load(Ordering::SeqCst)
}

#[no_mangle]
pub extern "C" fn rde_attach(view_ptr: *mut c_void) -> i32 {
    if view_ptr.is_null() {
        return 0;
    }
    let ok = Arc::new(AtomicI32::new(0));
    let ok_store = ok.clone();
    on_main(move || {
        if as_view(view_ptr).is_none() {
            return;
        }
        let mut state = STATE.lock().expect("rde state");
        state.attached = view_ptr;
        state.queue.head = 0;
        state.queue.count = 0;
        install_monitor(&mut state);
        ok_store.store(1, Ordering::SeqCst);
    });
    ok.load(Ordering::SeqCst)
}

#[no_mangle]
pub extern "C" fn rde_detach(view_ptr: *mut c_void) {
    on_main(move || {
        let mut state = STATE.lock().expect("rde state");
        if state.attached == view_ptr || view_ptr.is_null() {
            state.attached = ptr::null_mut();
            remove_monitor(&mut state);
            state.queue.head = 0;
            state.queue.count = 0;
        }
    });
}

#[no_mangle]
pub unsafe extern "C" fn rde_snapshot(view_ptr: *mut c_void, out: *mut Snapshot) -> i32 {
    if view_ptr.is_null() || out.is_null() {
        return 0;
    }
    unsafe {
        *out = Snapshot::empty();
    }
    let ok = Arc::new(AtomicI32::new(0));
    let ok_store = ok.clone();
    on_main(move || {
        let Some(mtm) = require_mtm() else {
            return;
        };
        let Some(view) = as_view(view_ptr) else {
            return;
        };
        let screen = NSEvent::mouseLocation();
        let Some(mapped) = map_screen(&view, screen, true, mtm) else {
            return;
        };
        let tablet = STATE.lock().expect("rde state").tablet;
        let snap = Snapshot {
            flags: FLAG_VALID
                | if mapped.inside { FLAG_INSIDE } else { 0 }
                | if view.window().is_some_and(|w| w.isKeyWindow()) {
                    FLAG_FOCUSED
                } else {
                    0
                },
            client_x: mapped.client_x,
            client_y: mapped.client_y,
            screen_x: mapped.screen_x,
            screen_y: mapped.screen_y,
            view_w: mapped.view_w,
            view_h: mapped.view_h,
            buttons: dom_buttons(NSEvent::pressedMouseButtons()),
            modifiers: modifiers(NSEvent::modifierFlags_class()),
            pressure: tablet.pressure,
            tilt_x: tablet.tilt_x,
            tilt_y: tablet.tilt_y,
            twist: tablet.twist,
            pointer_type: tablet.pointer_type,
        };
        unsafe {
            *out = snap;
        }
        ok_store.store(1, Ordering::SeqCst);
    });
    ok.load(Ordering::SeqCst)
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
