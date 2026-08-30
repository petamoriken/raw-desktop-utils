import {
  KeyboardEvent,
  type KeyboardEventInitDict,
  MouseEvent,
  type MouseEventInitDict,
  PointerEvent,
  type PointerEventInitDict,
  type SynthesizedEvent,
  WheelEvent,
  type WheelEventInitDict,
} from "./events.ts";
import {
  bitFromButton,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  buttonFromBit,
  effectivePressure,
  type NativeQueuedEvent,
  type PointerSnapshot,
} from "./types.ts";

export type SynthesizeOptions = {
  mouseEvents?: boolean;
  view?: EventTarget | null;
  pointerId?: number;
};

const BUTTON_BITS = [1, 4, 2, 8, 16];

function modifiers(flags: number): Pick<
  MouseEventInitDict,
  "shiftKey" | "ctrlKey" | "altKey" | "metaKey"
> {
  return {
    shiftKey: (flags & 1) !== 0,
    ctrlKey: (flags & 2) !== 0,
    altKey: (flags & 4) !== 0,
    metaKey: (flags & 8) !== 0,
  };
}

function coords(
  snap: Pick<PointerSnapshot, "clientX" | "clientY" | "screenX" | "screenY">,
  prev: PointerSnapshot | null,
): Pick<
  MouseEventInitDict,
  | "clientX"
  | "clientY"
  | "screenX"
  | "screenY"
  | "offsetX"
  | "offsetY"
  | "pageX"
  | "pageY"
  | "movementX"
  | "movementY"
> {
  const movementX = prev ? snap.clientX - prev.clientX : 0;
  const movementY = prev ? snap.clientY - prev.clientY : 0;
  return {
    clientX: snap.clientX,
    clientY: snap.clientY,
    screenX: snap.screenX,
    screenY: snap.screenY,
    offsetX: snap.clientX,
    offsetY: snap.clientY,
    pageX: snap.clientX,
    pageY: snap.clientY,
    movementX,
    movementY,
  };
}

function pointerInit(
  snap: PointerSnapshot,
  prev: PointerSnapshot | null,
  extra: Partial<PointerEventInitDict>,
  opts: SynthesizeOptions,
): PointerEventInitDict {
  const buttons = extra.buttons ?? snap.buttons;
  return {
    bubbles: true,
    cancelable: true,
    view: opts.view ?? null,
    pointerId: opts.pointerId ?? 1,
    isPrimary: true,
    pointerType: snap.pointerType,
    width: 1,
    height: 1,
    tiltX: snap.tiltX,
    tiltY: snap.tiltY,
    twist: snap.twist,
    ...modifiers(snap.modifiers),
    ...coords(snap, prev),
    ...extra,
    buttons,
    pressure: extra.pressure ??
      effectivePressure(snap.pressure, buttons, snap.pointerType),
  };
}

function mouseInit(
  pointer: PointerEventInitDict,
  extra: Partial<MouseEventInitDict> = {},
): MouseEventInitDict {
  return { ...pointer, ...extra };
}

export type SynthResult = {
  events: SynthesizedEvent[];
  state: PointerSnapshot;
};

function pushPointer(
  out: SynthesizedEvent[],
  type: string,
  init: PointerEventInitDict,
  mouseType: string | null,
  opts: SynthesizeOptions,
) {
  out.push(new PointerEvent(type, init));
  if (opts.mouseEvents !== false && mouseType) {
    out.push(new MouseEvent(mouseType, mouseInit(init)));
  }
}

function enterLeave(
  out: SynthesizedEvent[],
  prev: PointerSnapshot | null,
  next: PointerSnapshot,
  opts: SynthesizeOptions,
) {
  const wasIn = prev?.inside ?? false;
  if (wasIn === next.inside) return;
  if (next.inside) {
    const init = pointerInit(next, prev, { button: 0, detail: 0 }, opts);
    pushPointer(out, "pointerover", init, "mouseover", opts);
    pushPointer(
      out,
      "pointerenter",
      { ...init, bubbles: false },
      "mouseenter",
      opts,
    );
  } else {
    const from = prev ?? next;
    const init = pointerInit(from, prev, {
      button: 0,
      detail: 0,
      clientX: next.clientX,
      clientY: next.clientY,
      screenX: next.screenX,
      screenY: next.screenY,
    }, opts);
    pushPointer(out, "pointerout", init, "mouseout", opts);
    pushPointer(
      out,
      "pointerleave",
      { ...init, bubbles: false },
      "mouseleave",
      opts,
    );
  }
}

function moved(a: PointerSnapshot, b: PointerSnapshot): boolean {
  return a.clientX !== b.clientX || a.clientY !== b.clientY ||
    a.screenX !== b.screenX || a.screenY !== b.screenY;
}

function fireMove(
  out: SynthesizedEvent[],
  prev: PointerSnapshot | null,
  next: PointerSnapshot,
  opts: SynthesizeOptions,
) {
  if (!next.inside && !(prev?.inside)) return;
  const init = pointerInit(next, prev, { button: -1, detail: 0 }, opts);
  pushPointer(out, "pointermove", init, "mousemove", opts);
}

function fireButtonDown(
  out: SynthesizedEvent[],
  prev: PointerSnapshot | null,
  next: PointerSnapshot,
  button: number,
  clickCount: number,
  opts: SynthesizeOptions,
) {
  const buttons = next.buttons | bitFromButton(button);
  const init = pointerInit(next, prev, {
    button,
    buttons,
    detail: clickCount,
  }, opts);
  pushPointer(out, "pointerdown", init, "mousedown", opts);
}

function fireButtonUp(
  out: SynthesizedEvent[],
  prev: PointerSnapshot | null,
  next: PointerSnapshot,
  button: number,
  clickCount: number,
  fireClick: boolean,
  opts: SynthesizeOptions,
) {
  const buttons = next.buttons & ~bitFromButton(button);
  const init = pointerInit(next, prev, {
    button,
    buttons,
    detail: clickCount,
  }, opts);
  pushPointer(out, "pointerup", init, "mouseup", opts);
  if (!fireClick || !next.inside) return;
  if (button === BUTTON_PRIMARY) {
    if (opts.mouseEvents !== false) {
      out.push(new MouseEvent("click", mouseInit(init)));
      if (clickCount === 2) {
        out.push(new MouseEvent("dblclick", mouseInit(init)));
      }
    }
  } else {
    if (opts.mouseEvents !== false) {
      out.push(new MouseEvent("auxclick", mouseInit(init)));
      if (button === BUTTON_SECONDARY) {
        out.push(
          new MouseEvent("contextmenu", mouseInit(init, { cancelable: true })),
        );
      }
    }
  }
}

function applyButtonDelta(
  out: SynthesizedEvent[],
  prev: PointerSnapshot,
  next: PointerSnapshot,
  opts: SynthesizeOptions,
) {
  const added = next.buttons & ~prev.buttons;
  const removed = prev.buttons & ~next.buttons;
  for (const bit of BUTTON_BITS) {
    if (added & bit) {
      fireButtonDown(out, prev, next, buttonFromBit(bit), 1, opts);
    }
  }
  for (const bit of BUTTON_BITS) {
    if (removed & bit) {
      fireButtonUp(out, prev, next, buttonFromBit(bit), 1, next.inside, opts);
    }
  }
}

function queuedToSnapshot(
  base: PointerSnapshot,
  ev: NativeQueuedEvent,
): PointerSnapshot {
  return {
    ...base,
    inside: true,
    clientX: ev.clientX,
    clientY: ev.clientY,
    screenX: ev.screenX,
    screenY: ev.screenY,
    buttons: ev.buttons,
    modifiers: ev.modifiers,
    pressure: ev.pressure >= 0 ? ev.pressure : base.pressure,
    tiltX: ev.tiltX,
    tiltY: ev.tiltY,
    twist: ev.twist,
    pointerType: ev.pointerType || base.pointerType,
    valid: true,
  };
}

function fireWheel(
  out: SynthesizedEvent[],
  prev: PointerSnapshot | null,
  next: PointerSnapshot,
  ev: NativeQueuedEvent,
  opts: SynthesizeOptions,
) {
  const init: WheelEventInitDict = {
    ...pointerInit(next, prev, { button: 0, detail: 0 }, opts),
    deltaX: ev.deltaX,
    deltaY: ev.deltaY,
    deltaZ: ev.deltaZ,
    deltaMode: ev.deltaMode,
  };
  out.push(new WheelEvent("wheel", init));
}

function fireKey(
  out: SynthesizedEvent[],
  ev: NativeQueuedEvent,
  opts: SynthesizeOptions,
) {
  const type = ev.type === 4 ? "keydown" : "keyup";
  const init: KeyboardEventInitDict = {
    bubbles: true,
    cancelable: true,
    view: opts.view ?? null,
    key: ev.key,
    code: ev.code,
    keyCode: ev.keyCode,
    repeat: ev.repeat,
    ...modifiers(ev.modifiers),
  };
  out.push(new KeyboardEvent(type, init));
}

/**
 * Turn a previous snapshot, a fresh snapshot, and any queued OS events
 * into UI Events / Pointer Events.
 *
 * Queued down/up/wheel/key events are authoritative. The snapshot fills
 * in hover, movement, and any button edges the queue missed.
 */
export function synthesize(
  prev: PointerSnapshot | null,
  next: PointerSnapshot,
  queued: readonly NativeQueuedEvent[] = [],
  opts: SynthesizeOptions = {},
): SynthResult {
  const out: SynthesizedEvent[] = [];
  let state = prev ? { ...prev } : null;

  if (!state) {
    enterLeave(out, null, next, opts);
    state = { ...next, buttons: 0 };
  }

  for (const ev of queued) {
    if (ev.type === 4 || ev.type === 5) {
      fireKey(out, ev, opts);
      continue;
    }
    const snap = queuedToSnapshot(state, ev);
    enterLeave(out, state, snap, opts);
    if (ev.type === 3) {
      if (moved(state, snap) && (snap.inside || state.inside)) {
        fireMove(out, state, snap, opts);
      }
      fireWheel(out, state, snap, ev, opts);
      state = snap;
      continue;
    }
    if (moved(state, snap) && (snap.inside || state.inside)) {
      fireMove(out, state, snap, opts);
    }
    if (ev.type === 1) {
      const down: PointerSnapshot = {
        ...snap,
        buttons: snap.buttons | bitFromButton(ev.button),
      };
      fireButtonDown(out, state, down, ev.button, ev.clickCount || 1, opts);
      state = down;
    } else if (ev.type === 2) {
      const up: PointerSnapshot = {
        ...snap,
        buttons: snap.buttons & ~bitFromButton(ev.button),
      };
      fireButtonUp(
        out,
        state,
        up,
        ev.button,
        ev.clickCount || 1,
        snap.inside,
        opts,
      );
      state = up;
    }
  }

  enterLeave(out, state, next, opts);
  if (state && next.inside && moved(state, next)) {
    fireMove(out, state, next, opts);
  }
  if (state && state.buttons !== next.buttons) {
    applyButtonDelta(out, state, next, opts);
  }

  return { events: out, state: next };
}

export function snapshotEqual(a: PointerSnapshot, b: PointerSnapshot): boolean {
  return a.valid === b.valid &&
    a.inside === b.inside &&
    a.focused === b.focused &&
    a.clientX === b.clientX &&
    a.clientY === b.clientY &&
    a.screenX === b.screenX &&
    a.screenY === b.screenY &&
    a.viewWidth === b.viewWidth &&
    a.viewHeight === b.viewHeight &&
    a.buttons === b.buttons &&
    a.modifiers === b.modifiers &&
    a.pressure === b.pressure &&
    a.tiltX === b.tiltX &&
    a.tiltY === b.tiltY &&
    a.twist === b.twist &&
    a.pointerType === b.pointerType;
}
