/**
 * Packed native snapshot. All fields are 4-byte aligned (100 bytes):
 * pointer (`flags` … `pointer_type`), window (`device_pixel_ratio` …
 * `outer_h`), screen (`screen_w` … `avail_h`).
 */
export const SNAPSHOT_BYTES = 100;
export const QUEUED_EVENT_BYTES = 108;
export const QUEUED_KEY_BYTES = 32;
export const ABI_VERSION = 3;
export const AUDIO_INFO_BYTES = 32;

export const FLAG_INSIDE = 1;
export const FLAG_FOCUSED = 2;
export const FLAG_VALID = 4;
