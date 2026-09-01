import { assertEquals } from "@std/assert";
import type { CompositionEvent, PointerEvent } from "../src/events.ts";
import { snapshotEqual, synthesize } from "../src/synthesize.ts";
import {
  BUTTONS_PRIMARY,
  BUTTONS_SECONDARY,
  emptySnapshot,
  NATIVE_EVENT_COMPOSITION_END,
  NATIVE_EVENT_COMPOSITION_START,
  NATIVE_EVENT_COMPOSITION_UPDATE,
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
    isComposing: false,
    ...partial,
  };
}

Deno.test("snapshot CapsLock reaches getModifierState", () => {
  const { events } = synthesize(null, snap({ modifiers: 16 }));
  const ev = events[0] as PointerEvent;
  assertEquals(ev.getModifierState("CapsLock"), true);
  assertEquals(ev.getModifierState("Accel"), false);
});

Deno.test("first sample inside fires enter events", () => {
  const { events } = synthesize(null, snap({ clientX: 10, clientY: 20 }));
  assertEquals(typesOf(events), [
    "pointerover",
    "pointerenter",
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
    "pointerleave",
  ]);
});

Deno.test("movement synthesizes pointermove", () => {
  const { events } = synthesize(
    snap({ clientX: 10, clientY: 20 }),
    snap({ clientX: 14, clientY: 24 }),
  );
  assertEquals(typesOf(events), ["pointermove"]);
  const p = events[0] as PointerEvent;
  assertEquals(p.button, -1);
  assertEquals(p.movementX, 4);
  assertEquals(p.movementY, 4);
  assertEquals(p.pressure, 0);
});

Deno.test("left button down/up synthesizes pointerdown/up", () => {
  const mid = snap({ clientX: 40, clientY: 50, buttons: BUTTONS_PRIMARY });
  const down = synthesize(snap({ clientX: 40, clientY: 50 }), mid);
  assertEquals(typesOf(down.events), ["pointerdown"]);
  const pd = down.events[0] as PointerEvent;
  assertEquals(pd.button, 0);
  assertEquals(pd.buttons, 1);
  assertEquals(pd.pressure, 0.5);

  const up = synthesize(mid, snap({ clientX: 40, clientY: 50, buttons: 0 }));
  assertEquals(typesOf(up.events), ["pointerup"]);
});

Deno.test("right button up is pointerup only", () => {
  const held = snap({ buttons: BUTTONS_SECONDARY, clientX: 1, clientY: 1 });
  const { events } = synthesize(
    held,
    snap({ buttons: 0, clientX: 1, clientY: 1 }),
  );
  assertEquals(typesOf(events), ["pointerup"]);
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
    "pointerup",
  ]);
});

Deno.test("queued wheel is not a session event", () => {
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
  assertEquals(typesOf(events), []);
});

Deno.test("queued keydown is not a session event", () => {
  const { events } = synthesize(snap(), snap(), [
    queued({
      type: NATIVE_EVENT_KEY_DOWN,
      key: "a",
      code: "KeyA",
      keyCode: 0,
    }),
  ]);
  assertEquals(typesOf(events), []);
});

Deno.test("pointerup outside the view still fires pointerup", () => {
  const { events } = synthesize(
    snap({ buttons: BUTTONS_PRIMARY, clientX: 10, clientY: 10 }),
    snap({ inside: false, buttons: 0, clientX: -4, clientY: -4 }),
  );
  assertEquals(events.some((e) => e.type === "pointerup"), true);
});

Deno.test("clickCount 2 is pointer detail, not a session dblclick", () => {
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
  assertEquals(typesOf(events), ["pointerdown", "pointerup"]);
  assertEquals((events[0] as PointerEvent).detail, 2);
  assertEquals((events[1] as PointerEvent).detail, 2);
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
  assertEquals(typesOf(events), ["pointerdown"]);
  assertEquals((events[0] as PointerEvent).detail, 2);
});

Deno.test("a release reports the count of the press it ends", () => {
  // The queue counted the second press; the snapshot, one poll later, is the
  // only one that sees the release.
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
  assertEquals(typesOf(up.events), ["pointerup"]);
  assertEquals((up.events[0] as PointerEvent).detail, 2);
  assertEquals(up.clickCounts[0], undefined);
});

Deno.test("queued composition events become CompositionEvent", () => {
  const { events } = synthesize(snap(), snap(), [
    queued({
      type: NATIVE_EVENT_COMPOSITION_START,
      key: "か",
    }),
    queued({
      type: NATIVE_EVENT_COMPOSITION_UPDATE,
      key: "かん",
    }),
    queued({
      type: NATIVE_EVENT_COMPOSITION_END,
      key: "漢",
    }),
  ]);
  assertEquals(typesOf(events), [
    "compositionstart",
    "compositionupdate",
    "compositionend",
  ]);
  assertEquals((events[0] as CompositionEvent).data, "か");
  assertEquals((events[0] as CompositionEvent).cancelable, true);
  assertEquals((events[1] as CompositionEvent).data, "かん");
  assertEquals((events[1] as CompositionEvent).cancelable, false);
  assertEquals((events[2] as CompositionEvent).data, "漢");
});

Deno.test("a drag keeps reporting after it leaves the view", () => {
  // Press inside: that is what captures the pointer.
  const idle = snap({ clientX: 10, clientY: 10, buttons: 0 });
  const press = synthesize(
    idle,
    snap({ clientX: 10, clientY: 10, buttons: BUTTONS_PRIMARY }),
  );
  assertEquals(press.captured, true);

  const outside = snap({
    clientX: -20,
    clientY: 900,
    buttons: BUTTONS_PRIMARY,
    inside: false,
  });
  const left = synthesize(press.state, outside, [], {
    captured: press.captured,
  });
  assertEquals(typesOf(left.events), [
    "pointerout",
    "pointerleave",
    "pointermove",
  ]);
  const move = left.events.find((e) =>
    e.type === "pointermove"
  ) as PointerEvent;
  assertEquals([move.clientX, move.clientY], [-20, 900]);

  // Still outside, still held: the browser keeps sending these.
  const farther = snap({
    clientX: -60,
    clientY: 950,
    buttons: BUTTONS_PRIMARY,
    inside: false,
  });
  const second = synthesize(outside, farther, [], { captured: left.captured });
  assertEquals(typesOf(second.events), ["pointermove"]);

  // The release drops the capture.
  const up = snap({ clientX: -60, clientY: 950, buttons: 0, inside: false });
  const end = synthesize(farther, up, [], { captured: second.captured });
  assertEquals(typesOf(end.events), ["pointerup"]);
  assertEquals(end.captured, false);
});

Deno.test("a drag that began in another window stays silent", () => {
  const a = snap({
    clientX: -20,
    clientY: 900,
    buttons: BUTTONS_PRIMARY,
    inside: false,
  });
  const b = snap({
    clientX: -60,
    clientY: 950,
    buttons: BUTTONS_PRIMARY,
    inside: false,
  });
  assertEquals(typesOf(synthesize(a, b, [], { captured: false }).events), []);
});

Deno.test("hovering outside the view reports nothing", () => {
  const a = snap({ clientX: -20, clientY: 900, buttons: 0, inside: false });
  const b = snap({ clientX: -60, clientY: 950, buttons: 0, inside: false });
  assertEquals(typesOf(synthesize(a, b).events), []);
});

Deno.test("a queued release past the edge is not a re-entry", () => {
  const { events } = synthesize(
    snap({ clientX: 10, clientY: 10, buttons: BUTTONS_PRIMARY }),
    snap({ clientX: -40, clientY: 900, buttons: 0, inside: false }),
    [
      queued({
        type: NATIVE_EVENT_POINTER_UP,
        button: 0,
        buttons: 0,
        clientX: -40,
        clientY: 900,
      }),
    ],
    { captured: true },
  );
  assertEquals(typesOf(events), [
    "pointerout",
    "pointerleave",
    "pointermove",
    "pointerup",
  ]);
});
