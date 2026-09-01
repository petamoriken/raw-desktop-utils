import {
  CompositionEvent,
  type CompositionEventInit,
  KeyboardEvent,
  type KeyboardEventInit,
  MouseEvent,
  type MouseEventInit,
  PointerEvent,
  type PointerEventInit,
  type SynthesizedEvent,
  WheelEvent,
  type WheelEventInit,
} from "./events.ts";
import {
  bitFromButton,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  buttonFromBit,
  effectivePressure,
  MOD_ALT,
  MOD_CAPS,
  MOD_COMPOSING,
  MOD_CTRL,
  MOD_META,
  MOD_REPEAT,
  MOD_SHIFT,
  NATIVE_EVENT_COMPOSITION_END,
  NATIVE_EVENT_COMPOSITION_START,
  NATIVE_EVENT_COMPOSITION_UPDATE,
  type NativeQueuedEvent,
  type PointerSnapshot,
} from "./types.ts";

export type SynthesizeOptions = {
  mouseEvents?: boolean;
  view?: EventTarget | null;
  pointerId?: number;
  /** Per-button `detail` from the last poll, so a release can report the press it ends. */
  clickCounts?: ClickCounts;
};

export type ClickCounts = Readonly<Record<number, number>>;

const BUTTON_BITS = [1, 4, 2, 8, 16];

function modifiers(flags: number): Pick<
  MouseEventInit,
  "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "capsLock"
> {
  return {
    shiftKey: (flags & MOD_SHIFT) !== 0,
    ctrlKey: (flags & MOD_CTRL) !== 0,
    altKey: (flags & MOD_ALT) !== 0,
    metaKey: (flags & MOD_META) !== 0,
    capsLock: (flags & MOD_CAPS) !== 0,
  };
}

function coords(
  snap: Pick<PointerSnapshot, "clientX" | "clientY" | "screenX" | "screenY">,
  prev: PointerSnapshot | null,
): Pick<
  MouseEventInit,
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
  extra: Partial<PointerEventInit>,
  opts: SynthesizeOptions,
): PointerEventInit {
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
  pointer: PointerEventInit,
  extra: Partial<MouseEventInit> = {},
): MouseEventInit {
  return { ...pointer, ...extra };
}

export type SynthResult = {
  events: SynthesizedEvent[];
  state: PointerSnapshot;
  clickCounts: ClickCounts;
};

function pushPointer(
  out: SynthesizedEvent[],
  type: string,
  init: PointerEventInit,
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
  counts: Record<number, number>,
  opts: SynthesizeOptions,
) {
  const added = next.buttons & ~prev.buttons;
  const removed = prev.buttons & ~next.buttons;
  for (const bit of BUTTON_BITS) {
    if (added & bit) {
      const button = buttonFromBit(bit);
      counts[button] ??= 1;
      fireButtonDown(out, prev, next, button, counts[button], opts);
    }
  }
  for (const bit of BUTTON_BITS) {
    if (removed & bit) {
      const button = buttonFromBit(bit);
      const count = counts[button] ?? 1;
      delete counts[button];
      fireButtonUp(out, prev, next, button, count, next.inside, opts);
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
    modifiers: ev.modifiers & ~(MOD_REPEAT | MOD_COMPOSING),
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
  const init: WheelEventInit = {
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
  const init: KeyboardEventInit = {
    bubbles: true,
    cancelable: true,
    view: opts.view ?? null,
    key: ev.key,
    code: ev.code,
    location: ev.location,
    keyCode: ev.keyCode,
    repeat: ev.repeat,
    isComposing: ev.isComposing,
    ...modifiers(ev.modifiers),
  };
  out.push(new KeyboardEvent(type, init));
}

function fireComposition(
  out: SynthesizedEvent[],
  ev: NativeQueuedEvent,
  opts: SynthesizeOptions,
) {
  const type = ev.type === NATIVE_EVENT_COMPOSITION_START
    ? "compositionstart"
    : ev.type === NATIVE_EVENT_COMPOSITION_UPDATE
    ? "compositionupdate"
    : "compositionend";
  const init: CompositionEventInit = {
    bubbles: true,
    cancelable: ev.type === NATIVE_EVENT_COMPOSITION_START,
    view: opts.view ?? null,
    data: ev.key,
  };
  out.push(new CompositionEvent(type, init));
}

/** Queue edges are authoritative; the snapshot fills hover, move, and missed buttons. */
export function synthesize(
  prev: PointerSnapshot | null,
  next: PointerSnapshot,
  queued: readonly NativeQueuedEvent[] = [],
  opts: SynthesizeOptions = {},
): SynthResult {
  const out: SynthesizedEvent[] = [];
  const counts: Record<number, number> = { ...opts.clickCounts };
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
    if (
      ev.type === NATIVE_EVENT_COMPOSITION_START ||
      ev.type === NATIVE_EVENT_COMPOSITION_UPDATE ||
      ev.type === NATIVE_EVENT_COMPOSITION_END
    ) {
      fireComposition(out, ev, opts);
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
    // Drop a queued edge the snapshot already reported.
    const bit = bitFromButton(ev.button);
    if (ev.type === 1) {
      if (state.buttons & bit) {
        state = snap;
        continue;
      }
      const down: PointerSnapshot = { ...snap, buttons: snap.buttons | bit };
      counts[ev.button] = ev.clickCount || 1;
      fireButtonDown(out, state, down, ev.button, counts[ev.button], opts);
      state = down;
    } else if (ev.type === 2) {
      if (!(state.buttons & bit)) {
        state = snap;
        continue;
      }
      const up: PointerSnapshot = { ...snap, buttons: snap.buttons & ~bit };
      const count = Math.max(ev.clickCount || 1, counts[ev.button] ?? 1);
      delete counts[ev.button];
      fireButtonUp(out, state, up, ev.button, count, snap.inside, opts);
      state = up;
    }
  }

  enterLeave(out, state, next, opts);
  if (state && next.inside && moved(state, next)) {
    fireMove(out, state, next, opts);
  }
  if (state && state.buttons !== next.buttons) {
    applyButtonDelta(out, state, next, counts, opts);
  }

  return { events: out, state: next, clickCounts: counts };
}

export function snapshotEqual(a: PointerSnapshot, b: PointerSnapshot): boolean {
  return Object.is(a.valid, b.valid) &&
    Object.is(a.inside, b.inside) &&
    Object.is(a.focused, b.focused) &&
    Object.is(a.clientX, b.clientX) &&
    Object.is(a.clientY, b.clientY) &&
    Object.is(a.screenX, b.screenX) &&
    Object.is(a.screenY, b.screenY) &&
    Object.is(a.viewWidth, b.viewWidth) &&
    Object.is(a.viewHeight, b.viewHeight) &&
    Object.is(a.devicePixelRatio, b.devicePixelRatio) &&
    Object.is(a.windowX, b.windowX) &&
    Object.is(a.windowY, b.windowY) &&
    Object.is(a.outerWidth, b.outerWidth) &&
    Object.is(a.outerHeight, b.outerHeight) &&
    Object.is(a.screenWidth, b.screenWidth) &&
    Object.is(a.screenHeight, b.screenHeight) &&
    Object.is(a.availLeft, b.availLeft) &&
    Object.is(a.availTop, b.availTop) &&
    Object.is(a.availWidth, b.availWidth) &&
    Object.is(a.availHeight, b.availHeight) &&
    Object.is(a.buttons, b.buttons) &&
    Object.is(a.modifiers, b.modifiers) &&
    Object.is(a.pressure, b.pressure) &&
    Object.is(a.tiltX, b.tiltX) &&
    Object.is(a.tiltY, b.tiltY) &&
    Object.is(a.twist, b.twist) &&
    Object.is(a.pointerType, b.pointerType);
}
