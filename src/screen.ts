import { inspectBranded, type InspectFn, kCustomInspect } from "./inspect.ts";
import type { ScreenMetrics } from "./types.ts";

export type { ScreenMetrics } from "./types.ts";

const illegalConstructorKey = Symbol("illegalConstructorKey");

export type ScreenInit = Partial<ScreenMetrics> & {
  colorDepth?: number;
  pixelDepth?: number;
};

export interface ScreenEventMap {
  change: Event;
}

export class Screen extends EventTarget {
  #width: number;
  #height: number;
  #availLeft: number;
  #availTop: number;
  #availWidth: number;
  #availHeight: number;
  #colorDepth: number;
  #pixelDepth: number;

  constructor(key: unknown = null, init: ScreenInit = {}) {
    if (key !== illegalConstructorKey) {
      throw new TypeError("Illegal constructor");
    }
    super();
    this.#width = init.width ?? 0;
    this.#height = init.height ?? 0;
    this.#availLeft = init.availLeft ?? 0;
    this.#availTop = init.availTop ?? 0;
    this.#availWidth = init.availWidth ?? this.#width;
    this.#availHeight = init.availHeight ?? this.#height;
    this.#colorDepth = init.colorDepth ?? 24;
    this.#pixelDepth = init.pixelDepth ?? this.#colorDepth;
  }

  get width(): number {
    return this.#width;
  }
  get height(): number {
    return this.#height;
  }
  get availLeft(): number {
    return this.#availLeft;
  }
  get availTop(): number {
    return this.#availTop;
  }
  get availWidth(): number {
    return this.#availWidth;
  }
  get availHeight(): number {
    return this.#availHeight;
  }
  get colorDepth(): number {
    return this.#colorDepth;
  }
  get pixelDepth(): number {
    return this.#pixelDepth;
  }

  replace(next: ScreenMetrics): boolean {
    const changed = this.#width !== next.width ||
      this.#height !== next.height ||
      this.#availLeft !== next.availLeft ||
      this.#availTop !== next.availTop ||
      this.#availWidth !== next.availWidth ||
      this.#availHeight !== next.availHeight;
    this.#width = next.width;
    this.#height = next.height;
    this.#availLeft = next.availLeft;
    this.#availTop = next.availTop;
    this.#availWidth = next.availWidth;
    this.#availHeight = next.availHeight;
    return changed;
  }

  override addEventListener<K extends keyof ScreenEventMap>(
    type: K,
    listener: (this: this, ev: ScreenEventMap[K]) => void,
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
  }

  override removeEventListener<K extends keyof ScreenEventMap>(
    type: K,
    listener: (this: this, ev: ScreenEventMap[K]) => void,
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
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #width in this,
      "Screen",
      () => ({
        width: this.#width,
        height: this.#height,
        availLeft: this.#availLeft,
        availTop: this.#availTop,
        availWidth: this.#availWidth,
        availHeight: this.#availHeight,
        colorDepth: this.#colorDepth,
        pixelDepth: this.#pixelDepth,
      }),
      inspect,
      options,
    );
  }
}

export function createScreen(init: ScreenInit = {}): Screen {
  return new Screen(illegalConstructorKey, init);
}
