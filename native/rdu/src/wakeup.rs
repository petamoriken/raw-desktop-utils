//! Wake the Deno isolate after a queued event. The C function is invoked from
//! this helper thread, never from an OS hook or AppKit monitor.

use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::{Condvar, Mutex};
use std::thread;

type NotifyFn = unsafe extern "C" fn();

static NOTIFY: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());
static STARTED: AtomicBool = AtomicBool::new(false);
static LOCK: Mutex<bool> = Mutex::new(false);
static CV: Condvar = Condvar::new();

pub fn set_notify(fn_ptr: *const c_void) {
    NOTIFY.store(fn_ptr.cast_mut(), Ordering::SeqCst);
    start();
    if fn_ptr.is_null() {
        signal();
    }
}

#[allow(dead_code)]
pub fn notify() {
    if NOTIFY.load(Ordering::SeqCst).is_null() {
        return;
    }
    signal();
}

fn signal() {
    let Ok(mut ready) = LOCK.lock() else {
        return;
    };
    *ready = true;
    CV.notify_one();
}

fn start() {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = thread::Builder::new().name("rdu-wake".into()).spawn(|| loop {
        let Ok(mut ready) = LOCK.lock() else {
            return;
        };
        while !*ready {
            ready = match CV.wait(ready) {
                Ok(g) => g,
                Err(_) => return,
            };
        }
        *ready = false;
        drop(ready);
        let ptr = NOTIFY.load(Ordering::SeqCst);
        if ptr.is_null() {
            continue;
        }
        let f: NotifyFn = unsafe { std::mem::transmute(ptr) };
        unsafe { f() };
    });
}

#[no_mangle]
pub extern "C" fn rdu_set_notify(fn_ptr: *const c_void) -> i32 {
    set_notify(fn_ptr);
    i32::from(!fn_ptr.is_null())
}
