import { assert, assertEquals } from "@std/assert";
import {
  type KeyboardEvent,
  MouseEvent,
  PointerEvent,
  WheelEvent,
} from "../src/events.ts";
import { snapshotEqual, synthesize } from "../src/synthesize.ts";
import {
  BUTTONS_PRIMARY,
  BUTTONS_SECONDARY,
  emptySnapshot,
  NATIVE_EVENT_KEY_DOWN,
  NATIVE_EVENT_POINTER_DOWN,
  NATIVE_EVENT_POINTER_UP,
  NATIVE_EVENT_WHEEL,
  type NativeQueuedEvent,
  type PointerSnapshot,
} from "../src/types.ts";

function snap(partial: Partial<PointerSnapshot> = {}): PointerSnapshot {
  return {
    ...emptySnapshot(),
    valid: true,
    inside: true,
    focused: true,
    viewWidth: 800,
    viewHeight: 600,
    pointerType: "mouse",
    ...partial,
  };
}

function typesOf(events: { type: string }[]): string[] {
  return events.map((e) => e.type);
}

function queued(
  partial: Partial<NativeQueuedEvent> & { type: NativeQueuedEvent["type"] },
): NativeQueuedEvent {
  return {
    button: 0,
    buttons: 0,
    modifiers: 0,
    clickCount: 1,
    keyCode: 0,
    clientX: 0,
    clientY: 0,
    screenX: 0,
    screenY: 0,
    deltaX: 0,
    deltaY: 0,
    deltaZ: 0,
    deltaMode: 0,
    pressure: -1,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "mouse",
    key: "",
    code: "",
    location: 0,
    repeat: false,
    ...partial,
  };
}

Deno.test("first sample inside fires enter events", () => {
  const { events } = synthesize(null, snap({ clientX: 10, clientY: 20 }));
  assertEquals(typesOf(events), [
    "pointerover",
    "mouseover",
    "pointerenter",
    "mouseenter",
  ]);
  const first = events[0] as PointerEvent;
  assertEquals(first.clientX, 10);
  assertEquals(first.clientY, 20);
});

Deno.test("leaving the view fires leave events", () => {
  const { events } = synthesize(
    snap({ clientX: 10, clientY: 20 }),
    snap({ inside: false, clientX: -1, clientY: -1 }),
  );
  assertEquals(typesOf(events), [
    "pointerout",
    "mouseout",
    "pointerleave",
    "mouseleave",
  ]);
});

Deno.test("movement synthesizes pointermove and mousemove", () => {
  const { events } = synthesize(
    snap({ clientX: 10, clientY: 20 }),
    snap({ clientX: 14, clientY: 24 }),
  );
  assertEquals(typesOf(events), ["pointermove", "mousemove"]);
  const p = events[0] as PointerEvent;
  assertEquals(p.button, -1);
  assertEquals(p.movementX, 4);
  assertEquals(p.movementY, 4);
  assertEquals(p.pressure, 0);
});

Deno.test("left button down/up synthesizes click", () => {
  const mid = snap({ clientX: 40, clientY: 50, buttons: BUTTONS_PRIMARY });
  const down = synthesize(snap({ clientX: 40, clientY: 50 }), mid);
  assertEquals(typesOf(down.events), ["pointerdown", "mousedown"]);
  const pd = down.events[0] as PointerEvent;
  assertEquals(pd.button, 0);
  assertEquals(pd.buttons, 1);
  assertEquals(pd.pressure, 0.5);

  const up = synthesize(mid, snap({ clientX: 40, clientY: 50, buttons: 0 }));
  assertEquals(typesOf(up.events), ["pointerup", "mouseup", "click"]);
});

Deno.test("right button up synthesizes auxclick and contextmenu", () => {
  const held = snap({ buttons: BUTTONS_SECONDARY, clientX: 1, clientY: 1 });
  const { events } = synthesize(
    held,
    snap({ buttons: 0, clientX: 1, clientY: 1 }),
  );
  assertEquals(typesOf(events), [
    "pointerup",
    "mouseup",
    "auxclick",
    "contextmenu",
  ]);
  assertEquals((events[0] as PointerEvent).button, 2);
});

Deno.test("queued down/up is authoritative", () => {
  const start = snap({ clientX: 8, clientY: 9 });
  const { events } = synthesize(
    start,
    snap({ clientX: 8, clientY: 9, buttons: 0 }),
    [
      queued({
        type: NATIVE_EVENT_POINTER_DOWN,
        button: 0,
        buttons: 1,
        clientX: 8,
        clientY: 9,
        clickCount: 1,
      }),
      queued({
        type: NATIVE_EVENT_POINTER_UP,
        button: 0,
        buttons: 0,
        clientX: 8,
        clientY: 9,
        clickCount: 1,
      }),
    ],
  );
  assertEquals(typesOf(events), [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
  ]);
});

Deno.test("queued wheel becomes WheelEvent", () => {
  const { events } = synthesize(
    snap({ clientX: 2, clientY: 3 }),
    snap({ clientX: 2, clientY: 3 }),
    [
      queued({
        type: NATIVE_EVENT_WHEEL,
        clientX: 2,
        clientY: 3,
        deltaY: 48,
        deltaMode: 0,
      }),
    ],
  );
  assert(events.some((e) => e instanceof WheelEvent && e.deltaY === 48));
});

Deno.test("queued keydown becomes KeyboardEvent", () => {
  const { events } = synthesize(snap(), snap(), [
    queued({
      type: NATIVE_EVENT_KEY_DOWN,
      key: "a",
      code: "KeyA",
      keyCode: 0,
    }),
  ]);
  assertEquals(typesOf(events), ["keydown"]);
});

Deno.test("mouseEvents: false omits compatibility events", () => {
  const { events } = synthesize(
    snap({ clientX: 0, clientY: 0 }),
    snap({ clientX: 1, clientY: 1, buttons: BUTTONS_PRIMARY }),
    [],
    { mouseEvents: false },
  );
  assertEquals(typesOf(events), ["pointermove", "pointerdown"]);
  assert(events.every((e) => e instanceof PointerEvent));
});

Deno.test("pointerup outside the view does not click", () => {
  const { events } = synthesize(
    snap({ buttons: BUTTONS_PRIMARY, clientX: 10, clientY: 10 }),
    snap({ inside: false, buttons: 0, clientX: -4, clientY: -4 }),
  );
  assertEquals(events.some((e) => e.type === "click"), false);
  assertEquals(events.some((e) => e.type === "pointerup"), true);
});

Deno.test("dblclick comes from clickCount 2", () => {
  const start = snap({ clientX: 1, clientY: 1 });
  const { events } = synthesize(start, snap({ clientX: 1, clientY: 1 }), [
    queued({
      type: NATIVE_EVENT_POINTER_DOWN,
      button: 0,
      buttons: 1,
      clientX: 1,
      clientY: 1,
      clickCount: 2,
    }),
    queued({
      type: NATIVE_EVENT_POINTER_UP,
      button: 0,
      buttons: 0,
      clientX: 1,
      clientY: 1,
      clickCount: 2,
    }),
  ]);
  assertEquals(
    events.some((e) => e instanceof MouseEvent && e.type === "dblclick"),
    true,
  );
});

Deno.test("snapshotEqual uses Object.is so NaN matches NaN", () => {
  assertEquals(
    snapshotEqual(snap({ clientX: NaN }), snap({ clientX: NaN })),
    true,
  );
  assertEquals(
    snapshotEqual(snap({ clientX: 1 }), snap({ clientX: NaN })),
    false,
  );
  assertEquals(
    snapshotEqual(snap({ clientX: 0 }), snap({ clientX: -0 })),
    false,
  );
});

Deno.test("a press the snapshot already reported does not fire twice", () => {
  // The snapshot won the race last poll, so `prev` is already pressed.
  const { events } = synthesize(
    snap({ clientX: 8, clientY: 9, buttons: BUTTONS_PRIMARY }),
    snap({ clientX: 8, clientY: 9, buttons: BUTTONS_PRIMARY }),
    [
      queued({
        type: NATIVE_EVENT_POINTER_DOWN,
        button: 0,
        buttons: BUTTONS_PRIMARY,
        clientX: 8,
        clientY: 9,
      }),
    ],
  );
  assertEquals(typesOf(events), []);
});

Deno.test("a release the snapshot already reported does not fire twice", () => {
  const { events } = synthesize(
    snap({ clientX: 8, clientY: 9, buttons: 0 }),
    snap({ clientX: 8, clientY: 9, buttons: 0 }),
    [
      queued({
        type: NATIVE_EVENT_POINTER_UP,
        button: 0,
        buttons: 0,
        clientX: 8,
        clientY: 9,
      }),
    ],
  );
  assertEquals(typesOf(events), []);
});

Deno.test("a queued press still wins when the snapshot has not caught up", () => {
  const { events } = synthesize(
    snap({ clientX: 8, clientY: 9, buttons: 0 }),
    snap({ clientX: 8, clientY: 9, buttons: BUTTONS_PRIMARY }),
    [
      queued({
        type: NATIVE_EVENT_POINTER_DOWN,
        button: 0,
        buttons: BUTTONS_PRIMARY,
        clientX: 8,
        clientY: 9,
        clickCount: 2,
      }),
    ],
  );
  assertEquals(typesOf(events), ["pointerdown", "mousedown"]);
  assertEquals((events[0] as PointerEvent).detail, 2);
});

Deno.test("a release reports the count of the press it ends", () => {
  // The queue counted the second press; the snapshot, one poll later, is the
  // only one that sees the release. `dblclick` still has to fire.
  const down = synthesize(
    snap({ buttons: 0 }),
    snap({ buttons: BUTTONS_PRIMARY }),
    [
      queued({
        type: NATIVE_EVENT_POINTER_DOWN,
        button: 0,
        buttons: BUTTONS_PRIMARY,
        clickCount: 2,
      }),
    ],
  );
  assertEquals(down.clickCounts[0], 2);

  const up = synthesize(
    snap({ buttons: BUTTONS_PRIMARY }),
    snap({ buttons: 0 }),
    [],
    { clickCounts: down.clickCounts },
  );
  assertEquals(typesOf(up.events), [
    "pointerup",
    "mouseup",
    "click",
    "dblclick",
  ]);
  assertEquals(up.clickCounts[0], undefined);
});

Deno.test("a queued key carries KeyboardEvent.location", () => {
  const { events } = synthesize(snap(), snap(), [
    queued({
      type: NATIVE_EVENT_KEY_DOWN,
      key: "Shift",
      code: "ShiftRight",
      location: 2,
    }),
  ]);
  assertEquals(typesOf(events), ["keydown"]);
  assertEquals((events[0] as KeyboardEvent).location, 2);
});
