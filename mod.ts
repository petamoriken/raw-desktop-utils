/**
 * Utilities for `deno desktop` raw windows: attach an input session,
 * poll OS pointer and key events as DOM events, and drive the loop
 * with `requestAnimationFrame`.
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
