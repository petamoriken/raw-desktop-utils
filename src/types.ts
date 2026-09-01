/** DOM `MouseEvent.buttons` bits. Matches AppKit `NSEvent.pressedMouseButtons`. */
export const BUTTONS_NONE = 0;
export const BUTTONS_PRIMARY = 1;
export const BUTTONS_SECONDARY = 2;
export const BUTTONS_AUXILIARY = 4;
export const BUTTONS_BACK = 8;
export const BUTTONS_FORWARD = 16;

/** DOM `MouseEvent.button` values. */
export const BUTTON_PRIMARY = 0;
export const BUTTON_AUXILIARY = 1;
export const BUTTON_SECONDARY = 2;
export const BUTTON_BACK = 3;
export const BUTTON_FORWARD = 4;

export const POINTER_TYPE_MOUSE = "mouse";
export const POINTER_TYPE_PEN = "pen";
export const POINTER_TYPE_TOUCH = "touch";

export type PointerType =
  | typeof POINTER_TYPE_MOUSE
  | typeof POINTER_TYPE_PEN
  | typeof POINTER_TYPE_TOUCH
  | "";

export const MOD_SHIFT = 1;
export const MOD_CTRL = 2;
export const MOD_ALT = 4;
export const MOD_META = 8;
/** `getModifierState("CapsLock")`. */
export const MOD_CAPS = 16;
/** Key event only: `KeyboardEvent.repeat`. */
export const MOD_REPEAT = 64;
/** Key event only: `KeyboardEvent.isComposing`. */
export const MOD_COMPOSING = 128;

export type NativePointerKind = 0 | 1 | 2;

/** Live pointer sample read from the OS. Coordinates use a top-left origin. */
export type PointerSnapshot = {
  valid: boolean;
  inside: boolean;
  focused: boolean;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  viewWidth: number;
  viewHeight: number;
  /** Physical backing pixels per logical (`getSize` / `clientX`) pixel. */
  devicePixelRatio: number;
  /** Outer window origin in top-left screen space (`Window.screenX`). */
  windowX: number;
  windowY: number;
  /** Outer window size including chrome (`Window.outerWidth`). */
  outerWidth: number;
  outerHeight: number;
  /** Monitor that contains the window (`Screen.width` / `height`). */
  screenWidth: number;
  screenHeight: number;
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  buttons: number;
  modifiers: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;
  pointerType: PointerType;
};

export const NATIVE_EVENT_POINTER_DOWN = 1;
export const NATIVE_EVENT_POINTER_UP = 2;
export const NATIVE_EVENT_WHEEL = 3;
export const NATIVE_EVENT_KEY_DOWN = 4;
export const NATIVE_EVENT_KEY_UP = 5;
export const NATIVE_EVENT_COMPOSITION_START = 6;
export const NATIVE_EVENT_COMPOSITION_UPDATE = 7;
export const NATIVE_EVENT_COMPOSITION_END = 8;

export type NativeEventKind =
  | typeof NATIVE_EVENT_POINTER_DOWN
  | typeof NATIVE_EVENT_POINTER_UP
  | typeof NATIVE_EVENT_WHEEL
  | typeof NATIVE_EVENT_KEY_DOWN
  | typeof NATIVE_EVENT_KEY_UP
  | typeof NATIVE_EVENT_COMPOSITION_START
  | typeof NATIVE_EVENT_COMPOSITION_UPDATE
  | typeof NATIVE_EVENT_COMPOSITION_END;

/** Discrete OS event drained from the native queue (down/up/wheel/key). */
export type NativeQueuedEvent = {
  type: NativeEventKind;
  button: number;
  buttons: number;
  modifiers: number;
  clickCount: number;
  keyCode: number;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  deltaMode: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;
  pointerType: PointerType;
  key: string;
  code: string;
  /** `KeyboardEvent.location`, derived from `code`. */
  location: number;
  repeat: boolean;
  isComposing: boolean;
};

/** HTML `Window` geometry in the same logical space as `getSize()`. */
export type WindowMetrics = {
  devicePixelRatio: number;
  screenX: number;
  screenY: number;
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
};

/** CSSOM View `Screen` geometry in the same logical space as `getSize()`. */
export type ScreenMetrics = {
  width: number;
  height: number;
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
};

export type DesktopWindow = EventTarget & {
  getSize(): [number, number];
};

export type AttachOptions = {
  /** Window title used to locate the native content view. */
  title?: string;
  /** Existing native view / `wl_surface*` / X11 window, if already known. */
  native?: Deno.PointerValue;
  /** Wayland `wl_display*` (`getNativeWindow().displayHandle`). Optional. */
  display?: Deno.PointerValue;
  /** Extra target that also receives synthesized events. */
  target?: EventTarget;
  /** Also fire compatibility mouse events. Default true. */
  mouseEvents?: boolean;
  /** Poll automatically on this interval (ms). Off by default. */
  autoPoll?: number;
  /** How long to wait for the native window to appear. Default 500ms. */
  locateTimeoutMs?: number;
};

export function pointerTypeFromNative(kind: number): PointerType {
  if (kind === 1) return POINTER_TYPE_PEN;
  if (kind === 2) return POINTER_TYPE_TOUCH;
  return POINTER_TYPE_MOUSE;
}

export function nativeFromPointerType(type: PointerType): NativePointerKind {
  if (type === POINTER_TYPE_PEN) return 1;
  if (type === POINTER_TYPE_TOUCH) return 2;
  return 0;
}

/** Map a `buttons` bit to the DOM `button` value. */
export function buttonFromBit(bit: number): number {
  if (bit === BUTTONS_PRIMARY) return BUTTON_PRIMARY;
  if (bit === BUTTONS_SECONDARY) return BUTTON_SECONDARY;
  if (bit === BUTTONS_AUXILIARY) return BUTTON_AUXILIARY;
  if (bit === BUTTONS_BACK) return BUTTON_BACK;
  if (bit === BUTTONS_FORWARD) return BUTTON_FORWARD;
  return BUTTON_PRIMARY;
}

/** Map a DOM `button` value to the matching `buttons` bit. */
export function bitFromButton(button: number): number {
  if (button === BUTTON_PRIMARY) return BUTTONS_PRIMARY;
  if (button === BUTTON_SECONDARY) return BUTTONS_SECONDARY;
  if (button === BUTTON_AUXILIARY) return BUTTONS_AUXILIARY;
  if (button === BUTTON_BACK) return BUTTONS_BACK;
  if (button === BUTTON_FORWARD) return BUTTONS_FORWARD;
  return 0;
}

export function emptySnapshot(): PointerSnapshot {
  return {
    valid: false,
    inside: false,
    focused: false,
    clientX: 0,
    clientY: 0,
    screenX: 0,
    screenY: 0,
    viewWidth: 0,
    viewHeight: 0,
    devicePixelRatio: 0,
    windowX: 0,
    windowY: 0,
    outerWidth: 0,
    outerHeight: 0,
    screenWidth: 0,
    screenHeight: 0,
    availLeft: 0,
    availTop: 0,
    availWidth: 0,
    availHeight: 0,
    buttons: 0,
    modifiers: 0,
    pressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: POINTER_TYPE_MOUSE,
  };
}

export function emptyMetrics(): WindowMetrics {
  return {
    devicePixelRatio: 1,
    screenX: 0,
    screenY: 0,
    innerWidth: 0,
    innerHeight: 0,
    outerWidth: 0,
    outerHeight: 0,
  };
}

/** Merge a native sample with `window.getSize()` when the helper omitted size. */
export function windowMetricsFrom(
  snap: PointerSnapshot,
  size: readonly [number, number],
): WindowMetrics {
  const innerWidth = snap.viewWidth > 0 ? snap.viewWidth : size[0];
  const innerHeight = snap.viewHeight > 0 ? snap.viewHeight : size[1];
  return {
    devicePixelRatio: snap.devicePixelRatio > 0 ? snap.devicePixelRatio : 1,
    screenX: snap.windowX,
    screenY: snap.windowY,
    innerWidth,
    innerHeight,
    outerWidth: snap.outerWidth > 0 ? snap.outerWidth : innerWidth,
    outerHeight: snap.outerHeight > 0 ? snap.outerHeight : innerHeight,
  };
}

export function screenMetricsFrom(snap: PointerSnapshot): ScreenMetrics {
  const width = snap.screenWidth;
  const height = snap.screenHeight;
  return {
    width,
    height,
    availLeft: snap.availLeft,
    availTop: snap.availTop,
    availWidth: snap.availWidth > 0 ? snap.availWidth : width,
    availHeight: snap.availHeight > 0 ? snap.availHeight : height,
  };
}

export function effectivePressure(
  pressure: number,
  buttons: number,
  pointerType: PointerType = POINTER_TYPE_MOUSE,
): number {
  if (
    pointerType === POINTER_TYPE_PEN &&
    Number.isFinite(pressure) &&
    pressure >= 0
  ) {
    return pressure;
  }
  return buttons ? 0.5 : 0;
}
