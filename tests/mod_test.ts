import { assertEquals } from "@std/assert";
import { BUTTONS_PRIMARY, PointerEvent, synthesize } from "../mod.ts";
import { emptySnapshot, type PointerSnapshot } from "../src/types.ts";

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

Deno.test("public entry synthesizes a primary click", () => {
  const { events } = synthesize(
    snap({ clientX: 4, clientY: 5 }),
    snap({ clientX: 4, clientY: 5, buttons: BUTTONS_PRIMARY }),
  );
  assertEquals(events[0] instanceof PointerEvent, true);
  assertEquals(events[0]?.type, "pointerdown");
});
