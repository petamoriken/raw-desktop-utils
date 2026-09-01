//! Fallback C ABI for unsupported targets.

use std::ffi::c_void;
use std::ptr;

use crate::abi::{QueuedEvent, Snapshot};

#[no_mangle]
pub extern "C" fn rdu_abi_version() -> i32 {
    crate::abi::ABI_VERSION
}

#[no_mangle]
pub extern "C" fn rdu_find_window(_utf8_title: *const u8) -> *mut c_void {
    ptr::null_mut()
}

#[no_mangle]
pub extern "C" fn rdu_find_front_window() -> *mut c_void {
    ptr::null_mut()
}

#[no_mangle]
pub extern "C" fn rdu_attach(_view_ptr: *mut c_void) -> i32 {
    0
}

#[no_mangle]
pub extern "C" fn rdu_detach(_view_ptr: *mut c_void) {}

#[no_mangle]
pub unsafe extern "C" fn rdu_snapshot(view_ptr: *mut c_void, out: *mut Snapshot) -> i32 {
    if view_ptr.is_null() || out.is_null() {
        return 0;
    }
    unsafe {
        *out = Snapshot::empty();
    }
    0
}

#[no_mangle]
pub extern "C" fn rdu_poll_events(
    _view_ptr: *mut c_void,
    _buf: *mut QueuedEvent,
    _cap: i32,
) -> i32 {
    0
}
