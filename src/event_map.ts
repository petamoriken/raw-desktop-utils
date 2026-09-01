import type {
  CompositionEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  WheelEvent,
} from "./events.ts";

/**
 * Event types dispatched by {@linkcode InputSession}, matching the
 * TypeScript DOM `GlobalEventHandlersEventMap` / Pointer Events names.
 */
export interface InputSessionEventMap {
  pointerover: PointerEvent;
  pointerenter: PointerEvent;
  pointerdown: PointerEvent;
  pointermove: PointerEvent;
  pointerup: PointerEvent;
  pointercancel: PointerEvent;
  pointerout: PointerEvent;
  pointerleave: PointerEvent;
  mouseover: MouseEvent;
  mouseenter: MouseEvent;
  mousedown: MouseEvent;
  mousemove: MouseEvent;
  mouseup: MouseEvent;
  mouseout: MouseEvent;
  mouseleave: MouseEvent;
  click: MouseEvent;
  dblclick: MouseEvent;
  auxclick: MouseEvent;
  contextmenu: MouseEvent;
  wheel: WheelEvent;
  keydown: KeyboardEvent;
  keyup: KeyboardEvent;
  compositionstart: CompositionEvent;
  compositionupdate: CompositionEvent;
  compositionend: CompositionEvent;
}
