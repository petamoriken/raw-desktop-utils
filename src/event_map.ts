import type { CompositionEvent, PointerEvent } from "./events.ts";

export interface InputSessionEventMap {
  pointerover: PointerEvent;
  pointerenter: PointerEvent;
  pointerdown: PointerEvent;
  pointermove: PointerEvent;
  pointerup: PointerEvent;
  pointercancel: PointerEvent;
  pointerout: PointerEvent;
  pointerleave: PointerEvent;
  compositionstart: CompositionEvent;
  compositionupdate: CompositionEvent;
  compositionend: CompositionEvent;
}
