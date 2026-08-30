/**
 * UI Events and Pointer Events for `deno desktop` raw mode.
 *
 * Raw windows have no DOM, so `PointerEvent` / `UIEvent` never fire.
 * This package samples the OS via FFI and synthesizes the same event
 * shapes a browser would dispatch.
 */
export { attach, InputSession } from "./src/session.ts";
export type { FrameRequestCallback } from "./src/session.ts";
export type { InputSessionEventMap } from "./src/event_map.ts";
export {
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  UIEvent,
  WheelEvent,
} from "./src/events.ts";
export type {
  KeyboardEventInit,
  MouseEventInit,
  PointerEventInit,
  UIEventInit,
  WheelEventInit,
} from "./src/events.ts";
export type { AttachOptions, DesktopWindow } from "./src/types.ts";
