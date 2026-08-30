import { assertEquals } from "@std/assert";
import {
  cancelAnimationFrame,
  requestAnimationFrame,
} from "../src/animation_frame.ts";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("requestAnimationFrame invokes the callback with a timestamp", async () => {
  const time = await new Promise<number>((resolve) => {
    requestAnimationFrame(resolve);
  });
  assertEquals(typeof time, "number");
  assertEquals(Number.isFinite(time), true);
});

Deno.test("callbacks queued in one frame run in order with the same time", async () => {
  const seen: number[] = [];
  let t0 = -1;
  let t1 = -2;
  await new Promise<void>((resolve) => {
    requestAnimationFrame((time) => {
      seen.push(1);
      t0 = time;
    });
    requestAnimationFrame((time) => {
      seen.push(2);
      t1 = time;
      resolve();
    });
  });
  assertEquals(seen, [1, 2]);
  assertEquals(t0, t1);
});

Deno.test("cancelAnimationFrame prevents the callback", async () => {
  let called = false;
  const id = requestAnimationFrame(() => {
    called = true;
  });
  cancelAnimationFrame(id);
  await wait(40);
  assertEquals(called, false);
});

Deno.test("rAF scheduled from a callback runs on a later frame", async () => {
  const times: number[] = [];
  await new Promise<void>((resolve) => {
    requestAnimationFrame((t1) => {
      times.push(t1);
      requestAnimationFrame((t2) => {
        times.push(t2);
        resolve();
      });
    });
  });
  assertEquals(times.length, 2);
  assertEquals(times[1]! >= times[0]!, true);
});
