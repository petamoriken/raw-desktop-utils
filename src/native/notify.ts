/** Holds a thread-safe FFI callback so native can wake the isolate. */
export class NativeNotify {
  #set: ((ptr: Deno.PointerValue) => number) | null;
  #cb: {
    pointer: Deno.PointerValue;
    close(): void;
  } | null = null;

  constructor(set: ((ptr: Deno.PointerValue) => number) | null | undefined) {
    this.#set = set ?? null;
  }

  get available(): boolean {
    return this.#set !== null;
  }

  set(handler: (() => void) | null): boolean {
    this.clear();
    if (!handler || !this.#set) return false;
    this.#cb = Deno.UnsafeCallback.threadSafe(
      { parameters: [], result: "void" },
      handler,
    );
    this.#set(this.#cb.pointer);
    return true;
  }

  clear(): void {
    this.#set?.(null);
    this.#cb?.close();
    this.#cb = null;
  }
}
