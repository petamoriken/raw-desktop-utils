export type FrameRequestCallback = (time: number) => void;

type RafHost = {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
};

const host = globalThis as typeof globalThis & RafHost;
const DEFAULT_HZ = 60;

function hostRaf(): ((callback: FrameRequestCallback) => number) | undefined {
  const fn = host.requestAnimationFrame;
  return typeof fn === "function" ? fn.bind(host) : undefined;
}

function hostCaf(): ((handle: number) => void) | undefined {
  const fn = host.cancelAnimationFrame;
  return typeof fn === "function" ? fn.bind(host) : undefined;
}

/** Host rAF, or a 60 Hz `setTimeout` polyfill. */
export class AnimationFrames {
  #nextId = 1;
  #pending = new Map<number, FrameRequestCallback>();
  #hostIds = new Set<number>();
  #scheduled = false;
  #hz = DEFAULT_HZ;
  #closed = false;

  request(callback: FrameRequestCallback): number {
    if (this.#closed) {
      throw new Error("raw-desktop-utils: InputSession is closed");
    }
    const raf = hostRaf();
    if (raf) {
      const id = raf((time) => {
        this.#hostIds.delete(id);
        if (!this.#closed) callback(time);
      });
      this.#hostIds.add(id);
      return id;
    }
    const id = this.#nextId++;
    this.#pending.set(id, callback);
    this.#schedule();
    return id;
  }

  cancel(handle: number): void {
    if (this.#hostIds.delete(handle)) {
      hostCaf()?.(handle);
      return;
    }
    this.#pending.delete(handle);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const caf = hostCaf();
    if (caf) {
      for (const id of this.#hostIds) caf(id);
    }
    this.#hostIds.clear();
    this.#pending.clear();
  }

  #schedule(): void {
    if (this.#scheduled || this.#pending.size === 0 || this.#closed) return;
    this.#scheduled = true;
    const period = 1000 / this.#hz;
    const now = performance.now();
    const delay = Math.max(0, period - (now % period));
    setTimeout(() => this.#flush(), delay);
  }

  #flush(): void {
    this.#scheduled = false;
    if (this.#closed) return;
    const time = performance.now();
    const callbacks = [...this.#pending.values()];
    this.#pending.clear();
    for (const callback of callbacks) {
      try {
        callback(time);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
    if (this.#pending.size > 0) this.#schedule();
  }
}
