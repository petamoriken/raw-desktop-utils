//! C ABI for raw-desktop-utils. Built as a cdylib and loaded via Deno FFI.

mod abi;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
mod stub;
