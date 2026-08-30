import { assertEquals, assertThrows } from "@std/assert";
import type { NativeBackend } from "../src/native/backend.ts";
import { InputSession } from "../src/session.ts";
import {
  emptySnapshot,
  type NativeQueuedEvent,
  type PointerSnapshot,
} from "../src/types.ts";

class FakeBackend implements NativeBackend {
  readonly os = "test";
  findWindow(): Deno.PointerValue {
    return null;
  }
  findFrontWindow(): Deno.PointerValue {
    return null;
  }
  attach(): boolean {
    return true;
  }
  detach(): void {}
  snapshot(): PointerSnapshot {
    return emptySnapshot();
  }
  pollEvents(): NativeQueuedEvent[] {
    return [];
  }
}

function desktopWindow(): EventTarget & { getSize: () => [number, number] } {
  const win = new EventTarget() as EventTarget & {
    getSize: () => [number, number];
  };
  win.getSize = () => [100, 80];
  return win;
}

function session(): InputSession {
  return new InputSession(
    desktopWindow(),
    new FakeBackend(),
    Deno.UnsafePointer.of(new Uint8Array(1)),
    {},
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("session requestAnimationFrame invokes the callback with a timestamp", async () => {
  using input = session();
  const time = await new Promise<number>((resolve) => {
    input.requestAnimationFrame(resolve);
  });
  assertEquals(typeof time, "number");
  assertEquals(Number.isFinite(time), true);
});

Deno.test("callbacks queued in one frame run in order with the same time", async () => {
  using input = session();
  const seen: number[] = [];
  let t0 = -1;
  let t1 = -2;
  await new Promise<void>((resolve) => {
    input.requestAnimationFrame((time) => {
      seen.push(1);
      t0 = time;
    });
    input.requestAnimationFrame((time) => {
      seen.push(2);
      t1 = time;
      resolve();
    });
  });
  assertEquals(seen, [1, 2]);
  assertEquals(t0, t1);
});

Deno.test("session cancelAnimationFrame prevents the callback", async () => {
  using input = session();
  let called = false;
  const id = input.requestAnimationFrame(() => {
    called = true;
  });
  input.cancelAnimationFrame(id);
  await wait(40);
  assertEquals(called, false);
});

Deno.test("rAF scheduled from a callback runs on a later frame", async () => {
  using input = session();
  const times: number[] = [];
  await new Promise<void>((resolve) => {
    input.requestAnimationFrame((t1) => {
      times.push(t1);
      input.requestAnimationFrame((t2) => {
        times.push(t2);
        resolve();
      });
    });
  });
  assertEquals(times.length, 2);
  assertEquals(times[1]! >= times[0]!, true);
});

Deno.test("closing the session cancels pending frames", async () => {
  const input = session();
  let called = false;
  input.requestAnimationFrame(() => {
    called = true;
  });
  input.close();
  await wait(40);
  assertEquals(called, false);
  assertThrows(() => input.requestAnimationFrame(() => {}));
});
