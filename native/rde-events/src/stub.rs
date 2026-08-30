//! Windows placeholder. Same C ABI as the macOS / Linux backends.
//!
//! TODO(windows): FindWindowW, GetCursorPos, GetAsyncKeyState, WH_GETMESSAGE.

use std::ffi::c_void;
use std::ptr;

use crate::abi::{QueuedEvent, Snapshot};

#[no_mangle]
pub extern "C" fn rde_abi_version() -> i32 {
    crate::abi::ABI_VERSION
}

#[no_mangle]
pub extern "C" fn rde_find_window(_utf8_title: *const u8) -> *mut c_void {
    ptr::null_mut()
}

#[no_mangle]
pub extern "C" fn rde_find_front_window() -> *mut c_void {
    ptr::null_mut()
}

#[no_mangle]
pub extern "C" fn rde_attach(_view_ptr: *mut c_void) -> i32 {
    0
}

#[no_mangle]
pub extern "C" fn rde_detach(_view_ptr: *mut c_void) {}

#[no_mangle]
pub unsafe extern "C" fn rde_snapshot(view_ptr: *mut c_void, out: *mut Snapshot) -> i32 {
    if view_ptr.is_null() || out.is_null() {
        return 0;
    }
    unsafe {
        *out = Snapshot::empty();
    }
    0
}

#[no_mangle]
pub extern "C" fn rde_poll_events(
    _view_ptr: *mut c_void,
    _buf: *mut QueuedEvent,
    _cap: i32,
) -> i32 {
    0
}
