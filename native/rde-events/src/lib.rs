//! C ABI for raw-desktop-events. Built as a cdylib and loaded via Deno FFI.

mod abi;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod stub;
