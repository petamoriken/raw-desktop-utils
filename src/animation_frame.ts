/** HTML `FrameRequestCallback`. */
export type FrameRequestCallback = (time: number) => void;

type RafHost = {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
};

const host = globalThis as typeof globalThis & RafHost;

const DEFAULT_HZ = 60;

let nextId = 1;
const pending = new Map<number, FrameRequestCallback>();
let scheduled = false;
let hz = DEFAULT_HZ;

/** Used after attach when the native helper can report the display rate. */
export function setRefreshRate(framesPerSecond: number): void {
  if (Number.isFinite(framesPerSecond) && framesPerSecond > 0) {
    hz = framesPerSecond;
  }
}

export function refreshRate(): number {
  return hz;
}

function hostRaf(): ((callback: FrameRequestCallback) => number) | undefined {
  const fn = host.requestAnimationFrame;
  return typeof fn === "function" ? fn.bind(host) : undefined;
}

function hostCaf(): ((handle: number) => void) | undefined {
  const fn = host.cancelAnimationFrame;
  return typeof fn === "function" ? fn.bind(host) : undefined;
}

function schedule(): void {
  if (scheduled || pending.size === 0) return;
  scheduled = true;
  const period = 1000 / hz;
  const now = performance.now();
  const delay = Math.max(0, period - (now % period));
  setTimeout(flush, delay);
}

function flush(): void {
  scheduled = false;
  const time = performance.now();
  const callbacks = [...pending.values()];
  pending.clear();
  for (const callback of callbacks) {
    try {
      callback(time);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }
  if (pending.size > 0) schedule();
}

/**
 * Queue `callback` for the next display frame. Same contract as the
 * HTML `Window.requestAnimationFrame` method.
 */
export function requestAnimationFrame(callback: FrameRequestCallback): number {
  const host = hostRaf();
  if (host) return host(callback);
  const id = nextId++;
  pending.set(id, callback);
  schedule();
  return id;
}

/** Cancel a callback previously passed to {@linkcode requestAnimationFrame}. */
export function cancelAnimationFrame(handle: number): void {
  const host = hostCaf();
  if (host) {
    host(handle);
    return;
  }
  pending.delete(handle);
}
