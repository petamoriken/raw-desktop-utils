//! X11 backend. Coordinates are already top-left (unlike AppKit).

use std::collections::VecDeque;
use std::ffi::{c_char, c_void, CStr};
use std::ptr;
use std::sync::Mutex;

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    AtomEnum, ChangeWindowAttributesAux, ConnectionExt, EventMask, KeyButMask, Window,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;

use crate::abi::{
    Chrome, QueuedEvent, Snapshot, EV_KEY_DOWN, EV_KEY_UP, EV_POINTER_DOWN, EV_POINTER_UP,
    EV_WHEEL, FLAG_FOCUSED, FLAG_INSIDE, FLAG_VALID, KEY_BYTES, MOD_ALT, MOD_CAPS, MOD_CTRL,
    MOD_META, MOD_SHIFT, PTR_MOUSE, QUEUE_CAP,
};

struct State {
    conn: Option<RustConnection>,
    root: Window,
    attached: Option<Window>,
    queue: VecDeque<QueuedEvent>,
}

static STATE: Mutex<State> = Mutex::new(State {
    conn: None,
    root: 0,
    attached: None,
    queue: VecDeque::new(),
});

fn window_from_ptr(ptr: *mut c_void) -> Option<Window> {
    let id = ptr as usize as u32;
    if id == 0 {
        None
    } else {
        Some(id)
    }
}

fn ptr_from_window(win: Window) -> *mut c_void {
    if win == 0 {
        ptr::null_mut()
    } else {
        win as usize as *mut c_void
    }
}

fn connect(state: &mut State) -> Option<&RustConnection> {
    if state.conn.is_none() {
        let (conn, screen_num) = RustConnection::connect(None).ok()?;
        let root = conn.setup().roots.get(screen_num)?.root;
        state.conn = Some(conn);
        state.root = root;
    }
    state.conn.as_ref()
}

fn modifiers(mask: KeyButMask) -> u32 {
    let mut m = 0;
    if mask.contains(KeyButMask::SHIFT) {
        m |= MOD_SHIFT;
    }
    if mask.contains(KeyButMask::CONTROL) {
        m |= MOD_CTRL;
    }
    if mask.contains(KeyButMask::MOD1) {
        m |= MOD_ALT;
    }
    if mask.contains(KeyButMask::MOD4) {
        m |= MOD_META;
    }
    // X11 folds Caps Lock into the same state mask every event carries.
    if mask.contains(KeyButMask::LOCK) {
        m |= MOD_CAPS;
    }
    m
}

fn buttons_from_mask(mask: KeyButMask) -> u32 {
    let mut buttons = 0;
    if mask.contains(KeyButMask::BUTTON1) {
        buttons |= 1;
    }
    if mask.contains(KeyButMask::BUTTON3) {
        buttons |= 2;
    }
    if mask.contains(KeyButMask::BUTTON2) {
        buttons |= 4;
    }
    buttons
}

fn dom_button(detail: u8) -> Option<u32> {
    match detail {
        1 => Some(0),
        2 => Some(1),
        3 => Some(2),
        _ => None,
    }
}

fn window_title(conn: &RustConnection, win: Window) -> Option<String> {
    let net_wm_name = conn.intern_atom(false, b"_NET_WM_NAME").ok()?.reply().ok()?.atom;
    let utf8 = conn.intern_atom(false, b"UTF8_STRING").ok()?.reply().ok()?.atom;
    if let Ok(reply) = conn.get_property(false, win, net_wm_name, utf8, 0, 256).ok()?.reply() {
        if !reply.value.is_empty() {
            return Some(String::from_utf8_lossy(&reply.value).into_owned());
        }
    }
    let reply = conn
        .get_property(false, win, AtomEnum::WM_NAME, AtomEnum::STRING, 0, 256)
        .ok()?
        .reply()
        .ok()?;
    if reply.value.is_empty() {
        None
    } else {
        Some(String::from_utf8_lossy(&reply.value).into_owned())
    }
}

fn find_title(conn: &RustConnection, win: Window, want: &str) -> Option<Window> {
    if window_title(conn, win).as_deref() == Some(want) {
        return Some(win);
    }
    let tree = conn.query_tree(win).ok()?.reply().ok()?;
    for child in tree.children {
        if let Some(found) = find_title(conn, child, want) {
            return Some(found);
        }
    }
    None
}

fn frame_extents(conn: &RustConnection, win: Window) -> (u32, u32, u32, u32) {
    let Ok(atom) = conn.intern_atom(false, b"_NET_FRAME_EXTENTS") else {
        return (0, 0, 0, 0);
    };
    let Ok(atom) = atom.reply() else {
        return (0, 0, 0, 0);
    };
    let Ok(cookie) = conn.get_property(false, win, atom.atom, AtomEnum::CARDINAL, 0, 4) else {
        return (0, 0, 0, 0);
    };
    let Ok(reply) = cookie.reply() else {
        return (0, 0, 0, 0);
    };
    let Some(values) = reply.value32() else {
        return (0, 0, 0, 0);
    };
    let vals: Vec<u32> = values.collect();
    if vals.len() >= 4 {
        (vals[0], vals[1], vals[2], vals[3])
    } else {
        (0, 0, 0, 0)
    }
}

fn work_area(conn: &RustConnection, root: Window) -> Option<(i32, i32, u32, u32)> {
    let atom = conn.intern_atom(false, b"_NET_WORKAREA").ok()?.reply().ok()?.atom;
    let reply = conn
        .get_property(false, root, atom, AtomEnum::CARDINAL, 0, 4)
        .ok()?
        .reply()
        .ok()?;
    let vals: Vec<u32> = reply.value32()?.collect();
    if vals.len() >= 4 {
        Some((vals[0] as i32, vals[1] as i32, vals[2], vals[3]))
    } else {
        None
    }
}

/// `devicePixelRatio` is 1: X11 client geometry is already the same space as
/// `getSize()`. `screenX` / `outer*` use `_NET_FRAME_EXTENTS` when present.
fn window_chrome(
    conn: &RustConnection,
    win: Window,
    root: Window,
    view_w: f32,
    view_h: f32,
) -> Chrome {
    let (left, right, top, bottom) = frame_extents(conn, win);
    let mut chrome = Chrome {
        device_pixel_ratio: 1.0,
        outer_w: view_w,
        outer_h: view_h,
        ..Chrome::empty()
    };
    if let Ok(cookie) = conn.translate_coordinates(win, root, 0, 0) {
        if let Ok(tr) = cookie.reply() {
            chrome.window_x = tr.dst_x as f32 - left as f32;
            chrome.window_y = tr.dst_y as f32 - top as f32;
            chrome.outer_w = view_w + left as f32 + right as f32;
            chrome.outer_h = view_h + top as f32 + bottom as f32;
        }
    }
    if let Ok(cookie) = conn.get_geometry(root) {
        if let Ok(geom) = cookie.reply() {
            chrome.screen_w = geom.width as f32;
            chrome.screen_h = geom.height as f32;
        }
    }
    if let Some((x, y, w, h)) = work_area(conn, root) {
        chrome.avail_x = x as f32;
        chrome.avail_y = y as f32;
        chrome.avail_w = w as f32;
        chrome.avail_h = h as f32;
    } else {
        chrome.avail_w = chrome.screen_w;
        chrome.avail_h = chrome.screen_h;
    }
    chrome
}

fn active_window(conn: &RustConnection, root: Window) -> Option<Window> {
    let atom = conn
        .intern_atom(false, b"_NET_ACTIVE_WINDOW")
        .ok()?
        .reply()
        .ok()?
        .atom;
    let reply = conn
        .get_property(false, root, atom, AtomEnum::WINDOW, 0, 1)
        .ok()?
        .reply()
        .ok()?;
    let values: Vec<u32> = reply.value32()?.collect();
    values.into_iter().next().filter(|id| *id != 0)
}

fn push(state: &mut State, ev: QueuedEvent) {
    if state.queue.len() == QUEUE_CAP {
        state.queue.pop_front();
    }
    state.queue.push_back(ev);
}

fn drain_events(state: &mut State) {
    let Some(conn) = state.conn.as_ref() else {
        return;
    };
    let mut incoming = Vec::new();
    while let Ok(Some(event)) = conn.poll_for_event() {
        let mut ev = QueuedEvent::empty();
        match event {
            Event::ButtonPress(e) => {
                ev.modifiers = modifiers(KeyButMask::from(e.state));
                ev.buttons = buttons_from_mask(KeyButMask::from(e.state));
                ev.client_x = e.event_x as f32;
                ev.client_y = e.event_y as f32;
                ev.screen_x = e.root_x as f32;
                ev.screen_y = e.root_y as f32;
                ev.click_count = 1;
                match e.detail {
                    4 => {
                        ev.type_ = EV_WHEEL;
                        ev.delta_y = -16.0;
                    }
                    5 => {
                        ev.type_ = EV_WHEEL;
                        ev.delta_y = 16.0;
                    }
                    6 => {
                        ev.type_ = EV_WHEEL;
                        ev.delta_x = -16.0;
                    }
                    7 => {
                        ev.type_ = EV_WHEEL;
                        ev.delta_x = 16.0;
                    }
                    detail => {
                        let Some(button) = dom_button(detail) else {
                            continue;
                        };
                        ev.type_ = EV_POINTER_DOWN;
                        ev.button = button;
                        ev.buttons |= match button {
                            0 => 1,
                            1 => 4,
                            2 => 2,
                            _ => 0,
                        };
                    }
                }
                incoming.push(ev);
            }
            Event::ButtonRelease(e) => {
                let Some(button) = dom_button(e.detail) else {
                    continue;
                };
                ev.type_ = EV_POINTER_UP;
                ev.button = button;
                ev.modifiers = modifiers(KeyButMask::from(e.state));
                ev.buttons = buttons_from_mask(KeyButMask::from(e.state));
                ev.client_x = e.event_x as f32;
                ev.client_y = e.event_y as f32;
                ev.screen_x = e.root_x as f32;
                ev.screen_y = e.root_y as f32;
                ev.click_count = 1;
                incoming.push(ev);
            }
            Event::KeyPress(e) => {
                ev.type_ = EV_KEY_DOWN;
                ev.key_code = e.detail as u32;
                ev.modifiers = modifiers(KeyButMask::from(e.state));
                ev.buttons = buttons_from_mask(KeyButMask::from(e.state));
                ev.client_x = e.event_x as f32;
                ev.client_y = e.event_y as f32;
                ev.screen_x = e.root_x as f32;
                ev.screen_y = e.root_y as f32;
                ev.key_len = 0;
                let _ = KEY_BYTES;
                incoming.push(ev);
            }
            Event::KeyRelease(e) => {
                ev.type_ = EV_KEY_UP;
                ev.key_code = e.detail as u32;
                ev.modifiers = modifiers(KeyButMask::from(e.state));
                ev.buttons = buttons_from_mask(KeyButMask::from(e.state));
                ev.client_x = e.event_x as f32;
                ev.client_y = e.event_y as f32;
                ev.screen_x = e.root_x as f32;
                ev.screen_y = e.root_y as f32;
                ev.key_len = 0;
                incoming.push(ev);
            }
            _ => {}
        }
    }
    let _ = conn;
    for ev in incoming {
        push(state, ev);
    }
}

pub(crate) unsafe fn find_window(utf8_title: *const c_char) -> *mut c_void {
    if utf8_title.is_null() {
        return ptr::null_mut();
    }
    let want = unsafe { CStr::from_ptr(utf8_title) }
        .to_string_lossy()
        .into_owned();
    let mut state = STATE.lock().expect("rdu state");
    if connect(&mut state).is_none() {
        return ptr::null_mut();
    }
    let root = state.root;
    let conn = state.conn.as_ref().unwrap();
    match find_title(conn, root, &want) {
        Some(win) => ptr_from_window(win),
        None => ptr::null_mut(),
    }
}

pub(crate) fn find_front_window() -> *mut c_void {
    let mut state = STATE.lock().expect("rdu state");
    if connect(&mut state).is_none() {
        return ptr::null_mut();
    }
    let root = state.root;
    let conn = state.conn.as_ref().unwrap();
    match active_window(conn, root) {
        Some(win) => ptr_from_window(win),
        None => ptr::null_mut(),
    }
}

pub(crate) fn attach(view_ptr: *mut c_void) -> i32 {
    let Some(win) = window_from_ptr(view_ptr) else {
        return 0;
    };
    let mut state = STATE.lock().expect("rdu state");
    if connect(&mut state).is_none() {
        return 0;
    }
    let mask = EventMask::BUTTON_PRESS
        | EventMask::BUTTON_RELEASE
        | EventMask::KEY_PRESS
        | EventMask::KEY_RELEASE
        | EventMask::POINTER_MOTION
        | EventMask::ENTER_WINDOW
        | EventMask::LEAVE_WINDOW
        | EventMask::FOCUS_CHANGE;
    let aux = ChangeWindowAttributesAux::new().event_mask(mask);
    {
        let conn = state.conn.as_ref().unwrap();
        if conn.change_window_attributes(win, &aux).is_err() {
            return 0;
        }
        let _ = conn.flush();
    }
    state.attached = Some(win);
    state.queue.clear();
    1
}

pub(crate) fn detach(view_ptr: *mut c_void) {
    let mut state = STATE.lock().expect("rdu state");
    if state.attached == window_from_ptr(view_ptr) || view_ptr.is_null() {
        state.attached = None;
        state.queue.clear();
    }
}

pub(crate) unsafe fn snapshot(view_ptr: *mut c_void, out: *mut Snapshot) -> i32 {
    if out.is_null() {
        return 0;
    }
    unsafe {
        *out = Snapshot::empty();
    }
    let Some(win) = window_from_ptr(view_ptr) else {
        return 0;
    };
    let mut state = STATE.lock().expect("rdu state");
    drain_events(&mut state);
    let Some(conn) = state.conn.as_ref() else {
        return 0;
    };
    let pointer = match conn.query_pointer(win) {
        Ok(cookie) => match cookie.reply() {
            Ok(reply) => reply,
            Err(_) => return 0,
        },
        Err(_) => return 0,
    };
    let geom = match conn.get_geometry(win) {
        Ok(cookie) => match cookie.reply() {
            Ok(reply) => reply,
            Err(_) => return 0,
        },
        Err(_) => return 0,
    };
    let focused = active_window(conn, state.root) == Some(win)
        || conn
            .get_input_focus()
            .ok()
            .and_then(|c| c.reply().ok())
            .is_some_and(|r| r.focus == win);
    let inside = pointer.same_screen
        && pointer.win_x >= 0
        && pointer.win_y >= 0
        && (pointer.win_x as u16) < geom.width
        && (pointer.win_y as u16) < geom.height;
    let mask = KeyButMask::from(pointer.mask);
    let view_w = geom.width as f32;
    let view_h = geom.height as f32;
    let mut snap = Snapshot {
        flags: FLAG_VALID
            | if inside { FLAG_INSIDE } else { 0 }
            | if focused { FLAG_FOCUSED } else { 0 },
        client_x: pointer.win_x as f32,
        client_y: pointer.win_y as f32,
        screen_x: pointer.root_x as f32,
        screen_y: pointer.root_y as f32,
        buttons: buttons_from_mask(mask),
        modifiers: modifiers(mask),
        pressure: if buttons_from_mask(mask) != 0 { 0.5 } else { 0.0 },
        tilt_x: 0.0,
        tilt_y: 0.0,
        twist: 0.0,
        pointer_type: PTR_MOUSE,
        ..Snapshot::empty()
    };
    snap.inner_w = view_w;
    snap.inner_h = view_h;
    snap.apply_chrome(window_chrome(conn, win, state.root, view_w, view_h));
    unsafe {
        *out = snap;
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
    let mut state = STATE.lock().expect("rdu state");
    drain_events(&mut state);
    let n = state.queue.len().min(cap as usize);
    for i in 0..n {
        unsafe {
            *buf.add(i) = state.queue.pop_front().unwrap();
        }
    }
    n as i32
}
