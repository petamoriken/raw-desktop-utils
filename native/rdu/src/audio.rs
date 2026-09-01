//! PCM sink. JS owns the graph; this plays interleaved f32.

use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

pub const AUDIO_INFO_BYTES: usize = 32;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AudioInfo {
    pub sample_rate: u32,
    pub channels: u32,
    pub frames_queued: u32,
    pub frames_capacity: u32,
    pub frames_consumed: u64,
    pub latency_frames: u32,
    pub _pad: u32,
}

const _: () = assert!(std::mem::size_of::<AudioInfo>() == AUDIO_INFO_BYTES);

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
mod device {
    use super::*;
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use rtrb::{Producer, RingBuffer};

    pub struct AudioDevice {
        producer: Producer<f32>,
        sample_rate: u32,
        channels: u32,
        frames_capacity: u32,
        sample_capacity: usize,
        frames_consumed: Arc<AtomicU64>,
        latency_frames: u32,
        paused: Arc<AtomicBool>,
        // Kept so the stream is not dropped.
        _stream: cpal::Stream,
    }

    impl AudioDevice {
        fn open(sample_rate: u32, channels: u32, buffer_frames: u32) -> Option<Box<Self>> {
            let host = cpal::default_host();
            let device = host.default_output_device()?;
            let default = device.default_output_config().ok()?;
            let rate = if sample_rate > 0 {
                cpal::SampleRate(sample_rate)
            } else {
                default.sample_rate()
            };
            let ch = if channels > 0 {
                channels as u16
            } else {
                default.channels()
            };
            let cap_frames = buffer_frames.max(128);
            let cap_samples = (cap_frames as usize) * (ch as usize);
            let (producer, mut consumer) = RingBuffer::<f32>::new(cap_samples);
            let frames_consumed = Arc::new(AtomicU64::new(0));
            let paused = Arc::new(AtomicBool::new(false));
            let consumed = frames_consumed.clone();
            let paused_flag = paused.clone();
            let ch_usize = ch as usize;
            let config = cpal::StreamConfig {
                channels: ch,
                sample_rate: rate,
                buffer_size: cpal::BufferSize::Default,
            };
            let stream = device
                .build_output_stream(
                    &config,
                    move |data: &mut [f32], _| {
                        if paused_flag.load(Ordering::Relaxed) {
                            data.fill(0.0);
                            return;
                        }
                        let mut n = 0usize;
                        for sample in data.iter_mut() {
                            match consumer.pop() {
                                Ok(v) => {
                                    *sample = v;
                                    n += 1;
                                }
                                Err(_) => *sample = 0.0,
                            }
                        }
                        if ch_usize > 0 {
                            consumed.fetch_add((n / ch_usize) as u64, Ordering::Relaxed);
                        }
                    },
                    |_| {},
                    None,
                )
                .ok()?;
            stream.play().ok()?;
            Some(Box::new(Self {
                producer,
                sample_rate: rate.0,
                channels: ch as u32,
                frames_capacity: cap_frames,
                sample_capacity: cap_samples,
                frames_consumed,
                latency_frames: cap_frames.min(1024),
                paused,
                _stream: stream,
            }))
        }

        fn write(&mut self, samples: &[f32]) -> u32 {
            if self.channels == 0 {
                return 0;
            }
            let mut written = 0usize;
            for &s in samples {
                if self.producer.push(s).is_err() {
                    break;
                }
                written += 1;
            }
            (written / self.channels as usize) as u32
        }

        fn info(&self) -> AudioInfo {
            let free = self.producer.slots();
            let queued_samples = self.sample_capacity.saturating_sub(free);
            let queued = if self.channels > 0 {
                (queued_samples / self.channels as usize) as u32
            } else {
                0
            };
            AudioInfo {
                sample_rate: self.sample_rate,
                channels: self.channels,
                frames_queued: queued,
                frames_capacity: self.frames_capacity,
                frames_consumed: self.frames_consumed.load(Ordering::Relaxed),
                latency_frames: self.latency_frames,
                _pad: 0,
            }
        }

        fn set_paused(&self, paused: bool) {
            self.paused.store(paused, Ordering::Relaxed);
        }
    }

    pub fn open(sample_rate: u32, channels: u32, buffer_frames: u32) -> *mut c_void {
        match AudioDevice::open(sample_rate, channels, buffer_frames) {
            Some(dev) => Box::into_raw(dev) as *mut c_void,
            None => ptr::null_mut(),
        }
    }

    pub unsafe fn close(handle: *mut c_void) {
        if !handle.is_null() {
            drop(unsafe { Box::from_raw(handle as *mut AudioDevice) });
        }
    }

    pub unsafe fn info(handle: *mut c_void, out: *mut AudioInfo) -> i32 {
        if handle.is_null() || out.is_null() {
            return 0;
        }
        let dev = unsafe { &*(handle as *mut AudioDevice) };
        unsafe {
            *out = dev.info();
        }
        1
    }

    pub unsafe fn write(handle: *mut c_void, samples: *const f32, frames: i32) -> i32 {
        if handle.is_null() || samples.is_null() || frames <= 0 {
            return 0;
        }
        let dev = unsafe { &mut *(handle as *mut AudioDevice) };
        let n = frames as usize * dev.channels as usize;
        let slice = unsafe { std::slice::from_raw_parts(samples, n) };
        dev.write(slice) as i32
    }

    pub unsafe fn set_paused(handle: *mut c_void, paused: bool) -> i32 {
        if handle.is_null() {
            return 0;
        }
        let dev = unsafe { &*(handle as *mut AudioDevice) };
        dev.set_paused(paused);
        1
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
mod device {
    use super::*;

    pub fn open(_sample_rate: u32, _channels: u32, _buffer_frames: u32) -> *mut c_void {
        ptr::null_mut()
    }

    pub unsafe fn close(_handle: *mut c_void) {}

    pub unsafe fn info(_handle: *mut c_void, _out: *mut AudioInfo) -> i32 {
        0
    }

    pub unsafe fn write(_handle: *mut c_void, _samples: *const f32, _frames: i32) -> i32 {
        0
    }

    pub unsafe fn set_paused(_handle: *mut c_void, _paused: bool) -> i32 {
        0
    }
}

#[no_mangle]
pub extern "C" fn rdu_audio_open(
    sample_rate: u32,
    channels: u32,
    buffer_frames: u32,
) -> *mut c_void {
    device::open(sample_rate, channels, buffer_frames)
}

#[no_mangle]
pub unsafe extern "C" fn rdu_audio_close(handle: *mut c_void) {
    unsafe { device::close(handle) };
}

#[no_mangle]
pub unsafe extern "C" fn rdu_audio_info(handle: *mut c_void, out: *mut AudioInfo) -> i32 {
    unsafe { device::info(handle, out) }
}

#[no_mangle]
pub unsafe extern "C" fn rdu_audio_write(
    handle: *mut c_void,
    samples: *const f32,
    frames: i32,
) -> i32 {
    unsafe { device::write(handle, samples, frames) }
}

#[no_mangle]
pub unsafe extern "C" fn rdu_audio_pause(handle: *mut c_void) -> i32 {
    unsafe { device::set_paused(handle, true) }
}

#[no_mangle]
pub unsafe extern "C" fn rdu_audio_resume(handle: *mut c_void) -> i32 {
    unsafe { device::set_paused(handle, false) }
}
