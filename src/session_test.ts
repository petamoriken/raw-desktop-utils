import { assertEquals } from "@std/assert";
import { PointerEvent } from "./events.ts";
import { kCustomInspect } from "./inspect.ts";
import type { NativeBackend } from "./native/backend.ts";
import { InputSession } from "./session.ts";
import {
  emptySnapshot,
  type NativeQueuedEvent,
  type PointerSnapshot,
} from "./types.ts";

function snap(partial: Partial<PointerSnapshot> = {}): PointerSnapshot {
  return {
    ...emptySnapshot(),
    valid: true,
    inside: true,
    focused: true,
    viewWidth: 100,
    viewHeight: 80,
    pointerType: "mouse",
    ...partial,
  };
}

class FakeBackend implements NativeBackend {
  readonly os = "test";
  #samples: PointerSnapshot[];
  #queued: NativeQueuedEvent[][];

  constructor(samples: PointerSnapshot[], queued: NativeQueuedEvent[][] = []) {
    this.#samples = samples;
    this.#queued = queued;
  }

  findWindow(_title: string): Deno.PointerValue {
    return null;
  }
  findFrontWindow(): Deno.PointerValue {
    return null;
  }
  attach(_handle: Deno.PointerValue): boolean {
    return true;
  }
  detach(_handle: Deno.PointerValue): void {}
  snapshot(_handle: Deno.PointerValue): PointerSnapshot {
    return this.#samples.shift() ?? emptySnapshot();
  }
  pollEvents(_handle: Deno.PointerValue): NativeQueuedEvent[] {
    return this.#queued.shift() ?? [];
  }
}

Deno.test("session poll dispatches synthesized pointer events", () => {
  const win = new EventTarget() as EventTarget & { getSize: () => [number, number] };
  win.getSize = () => [100, 80];
  const backend = new FakeBackend([
    snap({ clientX: 1, clientY: 2 }),
    snap({ clientX: 3, clientY: 4, buttons: 1 }),
  ]);
  using session = new InputSession(win, backend, Deno.UnsafePointer.of(new Uint8Array(1)), {});
  const seen: string[] = [];
  session.addEventListener("pointerenter", () => seen.push("pointerenter"));
  session.addEventListener("pointermove", () => seen.push("pointermove"));
  session.addEventListener("pointerdown", (e) => {
    seen.push("pointerdown");
    assertEquals((e as PointerEvent).button, 0);
  });
  session.poll();
  session.poll();
  assertEquals(seen, ["pointerenter", "pointermove", "pointerdown"]);
});

Deno.test("session customInspect hides private fields", () => {
  const win = new EventTarget() as EventTarget & { getSize: () => [number, number] };
  win.getSize = () => [1, 1];
  const session = new InputSession(
    win,
    new FakeBackend([snap()]),
    Deno.UnsafePointer.of(new Uint8Array(1)),
    {},
  );
  const text = Deno.inspect(session);
  assertEquals(text.includes("InputSession"), true);
  assertEquals(text.includes("#"), false);
  session.close();
  assertEquals(session.closed, true);
});

Deno.test("kCustomInspect is the Deno inspect symbol", () => {
  assertEquals(kCustomInspect, Symbol.for("Deno.customInspect"));
});
