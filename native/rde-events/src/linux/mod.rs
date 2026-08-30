//! Linux dispatcher: Wayland when `WAYLAND_DISPLAY` is set (same as
//! laufey_winit), otherwise X11.

use std::ffi::{c_char, c_void};

use crate::abi::Snapshot;

mod wayland;
mod x11;

fn use_wayland(view_ptr: *mut c_void) -> bool {
    if !wayland::prefer_wayland() {
        return false;
    }
    view_ptr.is_null() || wayland::looks_like_wayland_surface(view_ptr)
}

#[no_mangle]
pub extern "C" fn rde_abi_version() -> i32 {
    crate::abi::ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn rde_find_window(utf8_title: *const c_char) -> *mut c_void {
    if wayland::prefer_wayland() {
        unsafe { wayland::find_window(utf8_title) }
    } else {
        unsafe { x11::find_window(utf8_title) }
    }
}

#[no_mangle]
pub extern "C" fn rde_find_front_window() -> *mut c_void {
    if wayland::prefer_wayland() {
        wayland::find_front_window()
    } else {
        x11::find_front_window()
    }
}

#[no_mangle]
pub extern "C" fn rde_set_display(display_ptr: *mut c_void) -> i32 {
    wayland::set_display(display_ptr);
    1
}

#[no_mangle]
pub extern "C" fn rde_attach(view_ptr: *mut c_void) -> i32 {
    if use_wayland(view_ptr) {
        wayland::attach(view_ptr)
    } else {
        x11::attach(view_ptr)
    }
}

#[no_mangle]
pub extern "C" fn rde_detach(view_ptr: *mut c_void) {
    if use_wayland(view_ptr) {
        wayland::detach(view_ptr);
    } else {
        x11::detach(view_ptr);
    }
}

#[no_mangle]
pub unsafe extern "C" fn rde_snapshot(view_ptr: *mut c_void, out: *mut Snapshot) -> i32 {
    if use_wayland(view_ptr) {
        unsafe { wayland::snapshot(view_ptr, out) }
    } else {
        unsafe { x11::snapshot(view_ptr, out) }
    }
}

#[no_mangle]
pub unsafe extern "C" fn rde_poll_events(
    view_ptr: *mut c_void,
    buf: *mut crate::abi::QueuedEvent,
    cap: i32,
) -> i32 {
    if use_wayland(view_ptr) {
        unsafe { wayland::poll_events(view_ptr, buf, cap) }
    } else {
        unsafe { x11::poll_events(view_ptr, buf, cap) }
    }
}
