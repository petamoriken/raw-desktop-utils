/**
 * UI Events and Pointer Events for `deno desktop` raw mode.
 *
 * Raw windows have no DOM, so `PointerEvent` / `UIEvent` never fire.
 * This package samples the OS via FFI and synthesizes the same event
 * shapes a browser would dispatch.
 */
export {
  attach,
  InputSession,
} from "./src/session.ts";
export {
  cloneSynthesized,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  UIEvent,
  WheelEvent,
} from "./src/events.ts";
export type {
  KeyboardEventInitDict,
  MouseEventInitDict,
  PointerEventInitDict,
  SynthesizedEvent,
  UIEventInitDict,
  WheelEventInitDict,
} from "./src/events.ts";
export { kCustomInspect } from "./src/inspect.ts";
export {
  findFrontWindow,
  findWindow,
  loadNative,
  NativeUnsupportedError,
} from "./src/native/mod.ts";
export type { NativeBackend } from "./src/native/mod.ts";
export {
  BUTTON_AUXILIARY,
  BUTTON_BACK,
  BUTTON_FORWARD,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  BUTTONS_AUXILIARY,
  BUTTONS_BACK,
  BUTTONS_FORWARD,
  BUTTONS_NONE,
  BUTTONS_PRIMARY,
  BUTTONS_SECONDARY,
  bitFromButton,
  buttonFromBit,
  effectivePressure,
  emptySnapshot,
  MOD_ALT,
  MOD_CTRL,
  MOD_META,
  MOD_SHIFT,
  NATIVE_EVENT_KEY_DOWN,
  NATIVE_EVENT_KEY_UP,
  NATIVE_EVENT_POINTER_DOWN,
  NATIVE_EVENT_POINTER_UP,
  NATIVE_EVENT_WHEEL,
  POINTER_TYPE_MOUSE,
  POINTER_TYPE_PEN,
  POINTER_TYPE_TOUCH,
} from "./src/types.ts";
export type {
  AttachOptions,
  DesktopWindow,
  NativeQueuedEvent,
  PointerSnapshot,
  PointerType,
} from "./src/types.ts";
export { synthesize } from "./src/synthesize.ts";
