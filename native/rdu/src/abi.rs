pub const ABI_VERSION: i32 = 3;

pub const FLAG_INSIDE: u32 = 1;
pub const FLAG_FOCUSED: u32 = 2;
pub const FLAG_VALID: u32 = 4;

pub const MOD_SHIFT: u32 = 1;
pub const MOD_CTRL: u32 = 2;
pub const MOD_ALT: u32 = 4;
pub const MOD_META: u32 = 8;
/// `KeyboardEvent.getModifierState("CapsLock")`.
pub const MOD_CAPS: u32 = 16;
/// Key event only: `KeyboardEvent.repeat`.
pub const MOD_REPEAT: u32 = 64;
/// Key event only: `KeyboardEvent.isComposing`.
pub const MOD_COMPOSING: u32 = 128;

pub const PTR_MOUSE: u32 = 0;
pub const PTR_PEN: u32 = 1;

pub const EV_POINTER_DOWN: u32 = 1;
pub const EV_POINTER_UP: u32 = 2;
pub const EV_WHEEL: u32 = 3;
pub const EV_KEY_DOWN: u32 = 4;
pub const EV_KEY_UP: u32 = 5;
pub const EV_COMPOSITION_START: u32 = 6;
pub const EV_COMPOSITION_UPDATE: u32 = 7;
pub const EV_COMPOSITION_END: u32 = 8;

pub const QUEUE_CAP: usize = 256;
pub const KEY_BYTES: usize = 32;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Snapshot {
    // Pointer sample
    pub flags: u32,
    pub client_x: f32,
    pub client_y: f32,
    pub screen_x: f32,
    pub screen_y: f32,
    pub buttons: u32,
    pub modifiers: u32,
    pub pressure: f32,
    pub tilt_x: f32,
    pub tilt_y: f32,
    pub twist: f32,
    pub pointer_type: u32,
    // Window (`devicePixelRatio`, `screenX`/`Y`, `inner*`/`outer*`)
    pub device_pixel_ratio: f32,
    pub window_x: f32,
    pub window_y: f32,
    pub inner_w: f32,
    pub inner_h: f32,
    pub outer_w: f32,
    pub outer_h: f32,
    // Screen (monitor that contains the window)
    pub screen_w: f32,
    pub screen_h: f32,
    pub avail_x: f32,
    pub avail_y: f32,
    pub avail_w: f32,
    pub avail_h: f32,
}

/// Window chrome plus the monitor work area. Not part of the C layout.
#[derive(Clone, Copy)]
pub struct Chrome {
    pub device_pixel_ratio: f32,
    pub window_x: f32,
    pub window_y: f32,
    pub outer_w: f32,
    pub outer_h: f32,
    pub screen_w: f32,
    pub screen_h: f32,
    pub avail_x: f32,
    pub avail_y: f32,
    pub avail_w: f32,
    pub avail_h: f32,
}

impl Chrome {
    pub const fn empty() -> Self {
        Self {
            device_pixel_ratio: 0.0,
            window_x: 0.0,
            window_y: 0.0,
            outer_w: 0.0,
            outer_h: 0.0,
            screen_w: 0.0,
            screen_h: 0.0,
            avail_x: 0.0,
            avail_y: 0.0,
            avail_w: 0.0,
            avail_h: 0.0,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct QueuedEvent {
    pub type_: u32,
    pub button: u32,
    pub buttons: u32,
    pub modifiers: u32,
    pub click_count: u32,
    pub key_code: u32,
    pub client_x: f32,
    pub client_y: f32,
    pub screen_x: f32,
    pub screen_y: f32,
    pub delta_x: f32,
    pub delta_y: f32,
    pub delta_z: f32,
    pub pressure: f32,
    pub tilt_x: f32,
    pub tilt_y: f32,
    pub twist: f32,
    pub pointer_type: u32,
    pub key_len: u32,
    pub key: [u8; KEY_BYTES],
}

impl Snapshot {
    pub const fn empty() -> Self {
        Self {
            flags: 0,
            client_x: 0.0,
            client_y: 0.0,
            screen_x: 0.0,
            screen_y: 0.0,
            buttons: 0,
            modifiers: 0,
            pressure: -1.0,
            tilt_x: 0.0,
            tilt_y: 0.0,
            twist: 0.0,
            pointer_type: PTR_MOUSE,
            device_pixel_ratio: 0.0,
            window_x: 0.0,
            window_y: 0.0,
            inner_w: 0.0,
            inner_h: 0.0,
            outer_w: 0.0,
            outer_h: 0.0,
            screen_w: 0.0,
            screen_h: 0.0,
            avail_x: 0.0,
            avail_y: 0.0,
            avail_w: 0.0,
            avail_h: 0.0,
        }
    }

    pub fn apply_chrome(&mut self, chrome: Chrome) {
        self.device_pixel_ratio = chrome.device_pixel_ratio;
        self.window_x = chrome.window_x;
        self.window_y = chrome.window_y;
        self.outer_w = chrome.outer_w;
        self.outer_h = chrome.outer_h;
        self.screen_w = chrome.screen_w;
        self.screen_h = chrome.screen_h;
        self.avail_x = chrome.avail_x;
        self.avail_y = chrome.avail_y;
        self.avail_w = chrome.avail_w;
        self.avail_h = chrome.avail_h;
    }
}

impl QueuedEvent {
    pub const fn empty() -> Self {
        Self {
            type_: 0,
            button: 0,
            buttons: 0,
            modifiers: 0,
            click_count: 0,
            key_code: 0,
            client_x: 0.0,
            client_y: 0.0,
            screen_x: 0.0,
            screen_y: 0.0,
            delta_x: 0.0,
            delta_y: 0.0,
            delta_z: 0.0,
            pressure: -1.0,
            tilt_x: 0.0,
            tilt_y: 0.0,
            twist: 0.0,
            pointer_type: PTR_MOUSE,
            key_len: 0,
            key: [0; KEY_BYTES],
        }
    }
}
