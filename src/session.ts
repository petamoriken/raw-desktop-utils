import {
  AnimationFrames,
  type FrameRequestCallback,
} from "./animation_frame.ts";
import type { InputSessionEventMap } from "./event_map.ts";
import { cloneSynthesized, type SynthesizedEvent } from "./events.ts";
import { inspectBranded, type InspectFn, kCustomInspect } from "./inspect.ts";
import { loadNative, type NativeBackend } from "./native/mod.ts";
import { createScreen, type Screen } from "./screen.ts";
import { type ClickCounts, synthesize } from "./synthesize.ts";
import type {
  AttachOptions,
  DesktopWindow,
  PointerSnapshot,
  WindowMetrics,
} from "./types.ts";
import {
  emptySnapshot,
  screenMetricsFrom,
  windowMetricsFrom,
} from "./types.ts";

export { Screen } from "./screen.ts";
export type { ScreenEventMap, ScreenInit } from "./screen.ts";

export type { FrameRequestCallback } from "./animation_frame.ts";

const DEFAULT_LOCATE_MS = 500;

export class InputSession extends EventTarget {
  readonly window: DesktopWindow;
  readonly #screen: Screen = createScreen();
  readonly #native: NativeBackend;
  readonly #handle: Deno.PointerValue;
  readonly #target: EventTarget | null;
  readonly #mouseEvents: boolean;
  #prev: PointerSnapshot | null = null;
  #clickCounts: ClickCounts = {};
  #captured = false;
  #last: PointerSnapshot = emptySnapshot();
  #metrics: WindowMetrics | null = null;
  #closed = false;
  #polling = false;
  #wakeAgain = false;
  #wakeQueued = false;
  #clock: ReturnType<typeof setInterval> | null = null;
  #listening = false;
  #hasNotify = false;
  #frames = new AnimationFrames();

  constructor(
    window: DesktopWindow,
    native: NativeBackend,
    handle: Deno.PointerValue,
    options: AttachOptions = {},
  ) {
    super();
    this.window = window;
    this.#native = native;
    this.#handle = handle;
    this.#target = options.target ?? null;
    this.#mouseEvents = options.mouseEvents !== false;
    this.#hasNotify = native.setNotify?.(() => this.#onNativeWake()) === true;
  }

  get closed(): boolean {
    return this.#closed;
  }

  get lastSnapshot(): PointerSnapshot {
    return this.#last;
  }

  get screen(): Screen {
    return this.#screen;
  }

  get devicePixelRatio(): number {
    return this.#currentMetrics().devicePixelRatio;
  }

  get screenX(): number {
    return this.#currentMetrics().screenX;
  }

  get screenY(): number {
    return this.#currentMetrics().screenY;
  }

  get screenLeft(): number {
    return this.screenX;
  }

  get screenTop(): number {
    return this.screenY;
  }

  get innerWidth(): number {
    return this.#currentMetrics().innerWidth;
  }

  get innerHeight(): number {
    return this.#currentMetrics().innerHeight;
  }

  get outerWidth(): number {
    return this.#currentMetrics().outerWidth;
  }

  get outerHeight(): number {
    return this.#currentMetrics().outerHeight;
  }

  metrics(): WindowMetrics {
    this.#assertOpen();
    const snap = this.#native.snapshot(this.#handle);
    return this.#remember(snap);
  }

  snapshot(): PointerSnapshot {
    this.#assertOpen();
    const next = this.#native.snapshot(this.#handle);
    this.#remember(next);
    return next;
  }

  poll(): PointerSnapshot {
    this.#assertOpen();
    if (this.#polling) {
      this.#wakeAgain = true;
      return this.#last;
    }
    this.#polling = true;
    try {
      do {
        this.#wakeAgain = false;
        this.#pollOnce();
      } while (this.#wakeAgain);
    } finally {
      this.#polling = false;
    }
    return this.#last;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopClock();
    this.#native.setNotify?.(null);
    this.#frames.close();
    this.#native.detach(this.#handle);
  }

  [Symbol.dispose](): void {
    this.close();
  }

  requestAnimationFrame(callback: FrameRequestCallback): number {
    this.#assertOpen();
    return this.#frames.request((time) => {
      if (!this.#closed) this.poll();
      callback(time);
    });
  }

  cancelAnimationFrame(handle: number): void {
    this.#frames.cancel(handle);
  }

  override addEventListener<K extends keyof InputSessionEventMap>(
    type: K,
    listener: (this: this, ev: InputSessionEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
    if (listener) this.#onListenerChange(true);
  }

  override removeEventListener<K extends keyof InputSessionEventMap>(
    type: K,
    listener: (this: this, ev: InputSessionEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
    if (listener) this.#onListenerChange(false);
  }

  #currentMetrics(): WindowMetrics {
    this.#assertOpen();
    return this.#metrics ?? this.metrics();
  }

  #remember(snap: PointerSnapshot): WindowMetrics {
    const next = windowMetricsFrom(snap, this.window.getSize());
    this.#metrics = next;
    if (this.#screen.replace(screenMetricsFrom(snap))) {
      this.#screen.dispatchEvent(new Event("change"));
    }
    return next;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("raw-desktop-utils: InputSession is closed");
    }
  }

  #pollOnce(): void {
    // Queue first: a later snapshot would replay a mid-poll press as up then down.
    const queued = this.#native.pollEvents(this.#handle);
    const next = this.#native.snapshot(this.#handle);
    const { events, clickCounts, captured } = synthesize(
      this.#prev,
      next,
      queued,
      {
        mouseEvents: this.#mouseEvents,
        view: this.window,
        clickCounts: this.#clickCounts,
        captured: this.#captured,
      },
    );
    this.#clickCounts = clickCounts;
    this.#captured = captured;
    this.#prev = next;
    this.#last = next;
    this.#remember(next);
    this.#emit(events);
  }

  #onNativeWake(): void {
    if (this.#closed || this.#wakeQueued) return;
    this.#wakeQueued = true;
    queueMicrotask(() => {
      this.#wakeQueued = false;
      if (!this.#closed) this.poll();
    });
  }

  #onListenerChange(added: boolean): void {
    if (added) this.#listening = true;
    if (this.#closed) return;
    // Host rAF may not tick without a present; keep a frame clock when the
    // native helper cannot wake us (a backend without setNotify).
    if (this.#listening && !this.#hasNotify) this.#startClock();
    else this.#stopClock();
  }

  #startClock(): void {
    if (this.#clock !== null) return;
    this.#clock = setInterval(() => {
      if (!this.#closed) this.poll();
    }, 16);
  }

  #stopClock(): void {
    if (this.#clock === null) return;
    clearInterval(this.#clock);
    this.#clock = null;
  }

  #emit(events: readonly SynthesizedEvent[]): void {
    const extra = this.#target;
    for (const event of events) {
      this.dispatchEvent(event);
      if (extra && extra !== this) extra.dispatchEvent(cloneSynthesized(event));
    }
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #closed in this,
      "InputSession",
      () => ({
        closed: this.#closed,
        os: this.#native.os,
        inside: this.#last.inside,
        focused: this.#last.focused,
        clientX: this.#last.clientX,
        clientY: this.#last.clientY,
        buttons: this.#last.buttons,
        devicePixelRatio: this.#metrics?.devicePixelRatio ?? 1,
        innerWidth: this.#metrics?.innerWidth ?? 0,
        innerHeight: this.#metrics?.innerHeight ?? 0,
      }),
      inspect,
      options,
    );
  }
}

export async function attach(
  win: DesktopWindow,
  options: AttachOptions = {},
): Promise<InputSession> {
  return attachWith(await loadNative(), win, options);
}

/** Attach with an already-loaded backend (platform subpath entries). */
export async function attachWith(
  native: NativeBackend,
  win: DesktopWindow,
  options: AttachOptions = {},
): Promise<InputSession> {
  // Title / `native` first. macOS raw `getNativeWindow()` can panic off-main.
  let handle = options.native ?? null;
  let display = options.display ?? null;
  if (!handle) handle = await locateHandle(native, options);
  if (!handle || (!display && native.os === "linux")) {
    const extracted = extractNativeHandles(win);
    handle ??= extracted.window;
    display ??= extracted.display;
  }
  if (!handle) {
    const hint = options.title
      ? ` (title=${JSON.stringify(options.title)})`
      : "";
    throw new Error(`raw-desktop-utils: native window not found${hint}`);
  }
  if (!native.attach(handle, display)) {
    throw new Error(
      "raw-desktop-utils: failed to attach to the native window",
    );
  }
  return new InputSession(win, native, handle, options);
}

async function locateHandle(
  native: NativeBackend,
  options: AttachOptions,
): Promise<Deno.PointerValue> {
  const timeout = options.locateTimeoutMs ?? DEFAULT_LOCATE_MS;
  const start = performance.now();
  while (true) {
    const handle = options.title
      ? native.findWindow(options.title)
      : native.findFrontWindow();
    if (handle) return handle;
    if (performance.now() - start >= timeout) break;
    await new Promise((r) => setTimeout(r, 16));
  }
  if (options.title) return native.findFrontWindow();
  return null;
}

function extractNativeHandles(win: DesktopWindow): {
  window: Deno.PointerValue;
  display: Deno.PointerValue;
} {
  const candidate = win as DesktopWindow & {
    getNativeWindow?: () => {
      windowHandle?: Deno.PointerValue;
      displayHandle?: Deno.PointerValue;
    };
  };
  if (typeof candidate.getNativeWindow !== "function") {
    return { window: null, display: null };
  }
  try {
    const surface = candidate.getNativeWindow();
    return {
      window: surface.windowHandle ?? null,
      display: surface.displayHandle ?? null,
    };
  } catch {
    return { window: null, display: null };
  }
}
