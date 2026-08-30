import { assertEquals } from "@std/assert";
import {
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  UIEvent,
  WheelEvent,
} from "./events.ts";
import {
  BUTTONS_PRIMARY,
  bitFromButton,
  buttonFromBit,
  effectivePressure,
  pointerTypeFromNative,
} from "./types.ts";

Deno.test("event inheritance matches UI Events", () => {
  const p = new PointerEvent("pointerdown", {
    clientX: 10,
    clientY: 20,
    buttons: 1,
    button: 0,
    pressure: 0.5,
    pointerType: "mouse",
  });
  assertEquals(p instanceof Event, true);
  assertEquals(p instanceof UIEvent, true);
  assertEquals(p instanceof MouseEvent, true);
  assertEquals(p instanceof PointerEvent, true);
  assertEquals(p.type, "pointerdown");
  assertEquals(p.clientX, 10);
  assertEquals(p.offsetX, 10);
  assertEquals(p.pageX, 10);
  assertEquals(p.pressure, 0.5);
  assertEquals(p.pointerId, 1);
  assertEquals(p.isPrimary, true);
  assertEquals(p.getCoalescedEvents(), []);
});

Deno.test("wheel and keyboard construct", () => {
  const w = new WheelEvent("wheel", { deltaY: 40, deltaMode: 0, clientX: 1 });
  assertEquals(w.deltaY, 40);
  assertEquals(w.deltaMode, WheelEvent.DOM_DELTA_PIXEL);
  const k = new KeyboardEvent("keydown", { key: "a", code: "KeyA", ctrlKey: true });
  assertEquals(k.key, "a");
  assertEquals(k.getModifierState("Control"), true);
  assertEquals(k.getModifierState("Shift"), false);
});

Deno.test("button bit mapping is DOM-shaped", () => {
  assertEquals(buttonFromBit(1), 0);
  assertEquals(buttonFromBit(2), 2);
  assertEquals(buttonFromBit(4), 1);
  assertEquals(bitFromButton(0), 1);
  assertEquals(bitFromButton(2), 2);
  assertEquals(bitFromButton(1), 4);
});

Deno.test("Deno.inspect uses customInspect and hides private fields", () => {
  const p = new PointerEvent("pointermove", {
    clientX: 3,
    clientY: 7,
    buttons: 0,
    button: -1,
    pressure: 0,
  });
  const text = Deno.inspect(p);
  assertEquals(text.includes("PointerEvent"), true);
  assertEquals(text.includes("clientX: 3"), true);
  assertEquals(text.includes("#"), false);
});

Deno.test("pressure defaults follow the Pointer Events spec", () => {
  assertEquals(effectivePressure(-1, 0), 0);
  assertEquals(effectivePressure(-1, BUTTONS_PRIMARY), 0.5);
  assertEquals(effectivePressure(0.8, BUTTONS_PRIMARY), 0.5);
  assertEquals(effectivePressure(0.8, BUTTONS_PRIMARY, "pen"), 0.8);
  assertEquals(pointerTypeFromNative(0), "mouse");
  assertEquals(pointerTypeFromNative(1), "pen");
  assertEquals(pointerTypeFromNative(2), "touch");
});
