import { assertEquals } from "@std/assert";
import type { NativeBackend } from "../src/native/backend.ts";
import { attachWith, InputSession } from "../src/session.ts";
import type { DesktopWindow } from "../src/types.ts";
import {
  emptySnapshot,
  type NativeQueuedEvent,
  type PointerSnapshot,
} from "../src/types.ts";

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
  readonly os: string;
  #samples: PointerSnapshot[];
  #queued: NativeQueuedEvent[][];
  #found: Deno.PointerValue;

  constructor(
    samples: PointerSnapshot[],
    queued: NativeQueuedEvent[][] = [],
    options: { os?: string; found?: Deno.PointerValue } = {},
  ) {
    this.os = options.os ?? "test";
    this.#samples = samples;
    this.#queued = queued;
    this.#found = options.found ?? null;
  }

  findWindow(_title: string): Deno.PointerValue {
    return this.#found;
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

function desktopWindow(): EventTarget & { getSize: () => [number, number] } {
  const win = new EventTarget() as EventTarget & {
    getSize: () => [number, number];
  };
  win.getSize = () => [100, 80];
  return win;
}

Deno.test("session poll dispatches synthesized pointer events", () => {
  const backend = new FakeBackend([
    snap({ clientX: 1, clientY: 2 }),
    snap({ clientX: 3, clientY: 4, buttons: 1 }),
  ]);
  using session = new InputSession(
    desktopWindow(),
    backend,
    Deno.UnsafePointer.of(new Uint8Array(1)),
    {},
  );
  const seen: string[] = [];
  session.addEventListener("pointerenter", () => seen.push("pointerenter"));
  session.addEventListener("pointermove", () => seen.push("pointermove"));
  session.addEventListener("pointerdown", (e) => {
    seen.push("pointerdown");
    assertEquals(e.button, 0);
  });
  session.poll();
  session.poll();
  assertEquals(seen, ["pointerenter", "pointermove", "pointerdown"]);
});

Deno.test("session customInspect hides private fields", () => {
  const session = new InputSession(
    desktopWindow(),
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

Deno.test("inspecting InputSession.prototype does not throw", () => {
  const text = Deno.inspect(InputSession.prototype);
  assertEquals(text.includes("InputSession"), true);
});

Deno.test("session exposes Window geometry and Screen from the snapshot", () => {
  const backend = new FakeBackend([
    snap({
      viewWidth: 640,
      viewHeight: 480,
      devicePixelRatio: 2,
      windowX: 12,
      windowY: 34,
      outerWidth: 640,
      outerHeight: 502,
      screenWidth: 1920,
      screenHeight: 1080,
      availLeft: 0,
      availTop: 25,
      availWidth: 1920,
      availHeight: 1055,
    }),
  ]);
  using session = new InputSession(
    desktopWindow(),
    backend,
    Deno.UnsafePointer.of(new Uint8Array(1)),
    {},
  );
  const seen: string[] = [];
  session.screen.addEventListener("change", () => seen.push("change"));
  session.poll();
  assertEquals(session.devicePixelRatio, 2);
  assertEquals(session.screenX, 12);
  assertEquals(session.screenY, 34);
  assertEquals(session.screenLeft, 12);
  assertEquals(session.screenTop, 34);
  assertEquals(session.innerWidth, 640);
  assertEquals(session.innerHeight, 480);
  assertEquals(session.outerWidth, 640);
  assertEquals(session.outerHeight, 502);
  assertEquals(session.screen instanceof EventTarget, true);
  assertEquals(session.screen.width, 1920);
  assertEquals(session.screen.height, 1080);
  assertEquals(session.screen.availTop, 25);
  assertEquals(session.screen.availHeight, 1055);
  assertEquals(session.screen.colorDepth, 24);
  assertEquals(seen, ["change"]);
});

Deno.test("session inner size falls back to window.getSize()", () => {
  const backend = new FakeBackend([snap({ viewWidth: 0, viewHeight: 0 })]);
  using session = new InputSession(
    desktopWindow(),
    backend,
    Deno.UnsafePointer.of(new Uint8Array(1)),
    {},
  );
  session.poll();
  assertEquals(session.innerWidth, 100);
  assertEquals(session.innerHeight, 80);
  assertEquals(session.devicePixelRatio, 1);
  assertEquals(session.outerWidth, 100);
  assertEquals(session.outerHeight, 80);
});

function pointerHandle(): Deno.PointerValue {
  return Deno.UnsafePointer.of(new Uint8Array(1));
}

function windowWithNative(
  handle: Deno.PointerValue,
): DesktopWindow & { nativeCalls: number } {
  const win = desktopWindow() as unknown as DesktopWindow & {
    nativeCalls: number;
    getNativeWindow: () => { windowHandle: Deno.PointerValue };
  };
  win.nativeCalls = 0;
  win.getNativeWindow = () => {
    win.nativeCalls += 1;
    return { windowHandle: handle };
  };
  return win;
}

Deno.test("attachWith uses options.native and skips getNativeWindow", async () => {
  const handle = pointerHandle();
  const win = windowWithNative(pointerHandle());
  using session = await attachWith(new FakeBackend([snap()]), win, {
    native: handle,
    locateTimeoutMs: 0,
  });
  assertEquals(win.nativeCalls, 0);
  session.poll();
});

Deno.test("attachWith locates by title and skips getNativeWindow", async () => {
  const handle = pointerHandle();
  const win = windowWithNative(pointerHandle());
  using session = await attachWith(
    new FakeBackend([snap()], [], { found: handle }),
    win,
    { title: "Game", locateTimeoutMs: 0 },
  );
  assertEquals(win.nativeCalls, 0);
  session.poll();
});

Deno.test("attachWith falls back to getNativeWindow on Linux", async () => {
  const handle = pointerHandle();
  const win = windowWithNative(handle);
  using session = await attachWith(
    new FakeBackend([snap()], [], { os: "linux" }),
    win,
    { locateTimeoutMs: 0 },
  );
  assertEquals(win.nativeCalls, 1);
  session.poll();
});

Deno.test("poll drains the native queue before sampling", () => {
  const calls: string[] = [];
  const backend = new FakeBackend([snap()]);
  const snapshot = backend.snapshot.bind(backend);
  const pollEvents = backend.pollEvents.bind(backend);
  backend.snapshot = (handle) => {
    calls.push("snapshot");
    return snapshot(handle);
  };
  backend.pollEvents = (handle) => {
    calls.push("pollEvents");
    return pollEvents(handle);
  };
  using session = new InputSession(
    desktopWindow(),
    backend,
    Deno.UnsafePointer.of(new Uint8Array(1)),
    {},
  );
  session.poll();
  // The snapshot has to be at least as new as the events it reconciles.
  assertEquals(calls, ["pollEvents", "snapshot"]);
});
