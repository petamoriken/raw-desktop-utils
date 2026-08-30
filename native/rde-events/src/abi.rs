pub const ABI_VERSION: i32 = 1;

pub const FLAG_INSIDE: u32 = 1;
pub const FLAG_FOCUSED: u32 = 2;
pub const FLAG_VALID: u32 = 4;

pub const MOD_SHIFT: u32 = 1;
pub const MOD_CTRL: u32 = 2;
pub const MOD_ALT: u32 = 4;
pub const MOD_META: u32 = 8;

pub const PTR_MOUSE: u32 = 0;
pub const PTR_PEN: u32 = 1;

pub const EV_POINTER_DOWN: u32 = 1;
pub const EV_POINTER_UP: u32 = 2;
pub const EV_WHEEL: u32 = 3;
pub const EV_KEY_DOWN: u32 = 4;
pub const EV_KEY_UP: u32 = 5;

pub const QUEUE_CAP: usize = 256;
pub const KEY_BYTES: usize = 32;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Snapshot {
    pub flags: u32,
    pub client_x: f32,
    pub client_y: f32,
    pub screen_x: f32,
    pub screen_y: f32,
    pub view_w: f32,
    pub view_h: f32,
    pub buttons: u32,
    pub modifiers: u32,
    pub pressure: f32,
    pub tilt_x: f32,
    pub tilt_y: f32,
    pub twist: f32,
    pub pointer_type: u32,
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
            view_w: 0.0,
            view_h: 0.0,
            buttons: 0,
            modifiers: 0,
            pressure: -1.0,
            tilt_x: 0.0,
            tilt_y: 0.0,
            twist: 0.0,
            pointer_type: PTR_MOUSE,
        }
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
