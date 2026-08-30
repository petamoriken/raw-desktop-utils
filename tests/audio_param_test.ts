import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { AudioParam } from "../src/audio/param.ts";

Deno.test("AudioParam starts at defaultValue", () => {
  const p = new AudioParam({ defaultValue: 0.5, name: "gain" });
  assertEquals(p.value, 0.5);
  assertEquals(p.defaultValue, 0.5);
});

Deno.test("setValueAtTime then linear ramp is sample-accurate", () => {
  const p = new AudioParam({ defaultValue: 0 });
  p.setValueAtTime(0, 0);
  p.linearRampToValueAtTime(1, 1);
  assertAlmostEquals(p.valueAt(0), 0, 1e-6);
  assertAlmostEquals(p.valueAt(0.5), 0.5, 1e-6);
  assertAlmostEquals(p.valueAt(1), 1, 1e-6);
  assertAlmostEquals(p.valueAt(2), 1, 1e-6);
});

Deno.test("fill writes an a-rate ramp", () => {
  const p = new AudioParam({ defaultValue: 0 });
  p.setValueAtTime(0, 0);
  p.linearRampToValueAtTime(1, 1);
  const out = new Float32Array(4);
  p.fill(out, 0, 4);
  assertAlmostEquals(out[0]!, 0, 1e-6);
  assertAlmostEquals(out[2]!, 0.5, 1e-6);
});

Deno.test("cancelScheduledValues drops future events", () => {
  const p = new AudioParam({ defaultValue: 0 });
  p.setValueAtTime(1, 1);
  p.setValueAtTime(2, 2);
  p.cancelScheduledValues(1.5);
  assertAlmostEquals(p.valueAt(3), 1, 1e-6);
});

Deno.test("automation time must be non-negative", () => {
  const p = new AudioParam();
  assertThrows(() => p.setValueAtTime(1, -1));
});

Deno.test("inspecting AudioParam.prototype does not throw", () => {
  Deno.inspect(AudioParam.prototype);
});
