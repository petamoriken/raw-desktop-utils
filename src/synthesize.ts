import {
  CompositionEvent,
  type CompositionEventInit,
  type MouseEventInit,
  PointerEvent,
  type PointerEventInit,
  type SynthesizedEvent,
} from "./events.ts";
import {
  bitFromButton,
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
  view?: EventTarget | null;
  pointerId?: number;
  /** Per-button `detail` from the last poll, so a release can report the press it ends. */
  clickCounts?: ClickCounts;
  /** A press that started inside is still held; from the last poll. */
  captured?: boolean;
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

export type SynthResult = {
  events: SynthesizedEvent[];
  state: PointerSnapshot;
  clickCounts: ClickCounts;
  captured: boolean;
};

function pushPointer(
  out: SynthesizedEvent[],
  type: string,
  init: PointerEventInit,
) {
  out.push(new PointerEvent(type, init));
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
    pushPointer(out, "pointerover", init);
    pushPointer(out, "pointerenter", { ...init, bubbles: false });
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
    pushPointer(out, "pointerout", init);
    pushPointer(out, "pointerleave", { ...init, bubbles: false });
  }
}

function moved(a: PointerSnapshot, b: PointerSnapshot): boolean {
  return a.clientX !== b.clientX || a.clientY !== b.clientY ||
    a.screenX !== b.screenX || a.screenY !== b.screenY;
}

/**
 * A drag that began inside keeps reporting once it leaves, the way a browser
 * keeps sending `pointermove` to the captured target with out-of-range
 * coordinates until the button comes back up. A press that began in another
 * window captures nothing and stays silent.
 */
function dragging(
  prev: PointerSnapshot | null,
  next: PointerSnapshot,
  opts: SynthesizeOptions,
): boolean {
  return opts.captured === true &&
    (next.buttons !== 0 || (prev?.buttons ?? 0) !== 0);
}

function fireMove(
  out: SynthesizedEvent[],
  prev: PointerSnapshot | null,
  next: PointerSnapshot,
  opts: SynthesizeOptions,
) {
  if (!next.inside && !prev?.inside && !dragging(prev, next, opts)) return;
  const init = pointerInit(next, prev, { button: -1, detail: 0 }, opts);
  pushPointer(out, "pointermove", init);
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
  pushPointer(out, "pointerdown", init);
}

function fireButtonUp(
  out: SynthesizedEvent[],
  prev: PointerSnapshot | null,
  next: PointerSnapshot,
  button: number,
  clickCount: number,
  opts: SynthesizeOptions,
) {
  const buttons = next.buttons & ~bitFromButton(button);
  const init = pointerInit(next, prev, {
    button,
    buttons,
    detail: clickCount,
  }, opts);
  pushPointer(out, "pointerup", init);
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
      if (next.inside) opts.captured = true;
      fireButtonDown(out, prev, next, button, counts[button], opts);
    }
  }
  for (const bit of BUTTON_BITS) {
    if (removed & bit) {
      const button = buttonFromBit(bit);
      const count = counts[button] ?? 1;
      delete counts[button];
      fireButtonUp(out, prev, next, button, count, opts);
    }
  }
}

function queuedToSnapshot(
  base: PointerSnapshot,
  ev: NativeQueuedEvent,
): PointerSnapshot {
  return {
    ...base,
    // The event is ours by construction, so bounds are the whole test. A drag
    // that releases past the edge must not read as a re-entry.
    inside: ev.clientX >= 0 && ev.clientY >= 0 &&
      ev.clientX < base.viewWidth && ev.clientY < base.viewHeight,
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
  // Mutated as presses go by, so a move later in this same call already sees
  // the capture the press established.
  const live: SynthesizeOptions = { ...opts };
  let state = prev ? { ...prev } : null;

  if (!state) {
    enterLeave(out, null, next, opts);
    state = { ...next, buttons: 0 };
  }

  for (const ev of queued) {
    // Key and wheel: BrowserWindow already dispatches these. Drain the record.
    if (ev.type === 4 || ev.type === 5) continue;
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
        fireMove(out, state, snap, live);
      }
      state = snap;
      continue;
    }
    if (moved(state, snap) && (snap.inside || state.inside)) {
      fireMove(out, state, snap, live);
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
      if (snap.inside) live.captured = true;
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
      fireButtonUp(out, state, up, ev.button, count, opts);
      state = up;
    }
  }

  enterLeave(out, state, next, opts);
  if (
    state && (next.inside || dragging(state, next, live)) && moved(state, next)
  ) {
    fireMove(out, state, next, live);
  }
  if (state && state.buttons !== next.buttons) {
    applyButtonDelta(out, state, next, counts, live);
  }

  // Capture ends with the last button, not with the pointer leaving.
  const captured = next.buttons !== 0 && live.captured === true;
  return { events: out, state: next, clickCounts: counts, captured };
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
