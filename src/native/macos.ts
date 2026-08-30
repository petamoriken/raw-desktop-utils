import {
  emptySnapshot,
  type NativeQueuedEvent,
  type PointerSnapshot,
} from "../types.ts";
import { inspectBranded, type InspectFn, kCustomInspect } from "../inspect.ts";
import { ABI_VERSION, QUEUED_EVENT_BYTES, SNAPSHOT_BYTES } from "./abi.ts";
import type { NativeBackend } from "./backend.ts";
import { macKeys } from "../keys/macos.ts";
import { compileNative, macosSpec } from "./compile.ts";
import { decodeQueuedEvents, decodeSnapshot } from "./decode.ts";

const SYMBOLS = {
  rde_abi_version: { parameters: [], result: "i32" },
  rde_find_window: { parameters: ["buffer"], result: "pointer" },
  rde_find_front_window: { parameters: [], result: "pointer" },
  rde_attach: { parameters: ["pointer"], result: "i32" },
  rde_detach: { parameters: ["pointer"], result: "void" },
  rde_snapshot: { parameters: ["pointer", "buffer"], result: "i32" },
  rde_poll_events: { parameters: ["pointer", "buffer", "i32"], result: "i32" },
} as const;

function cstr(text: string): Uint8Array {
  return new TextEncoder().encode(`${text}\0`);
}

export class MacosBackend implements NativeBackend {
  readonly os = "darwin";
  readonly #dl: Deno.DynamicLibrary<typeof SYMBOLS>;

  constructor(dl: Deno.DynamicLibrary<typeof SYMBOLS>) {
    this.#dl = dl;
  }

  get abiVersion(): number {
    return this.#dl.symbols.rde_abi_version();
  }

  findWindow(title: string): Deno.PointerValue {
    return this.#dl.symbols.rde_find_window(cstr(title));
  }

  findFrontWindow(): Deno.PointerValue {
    return this.#dl.symbols.rde_find_front_window();
  }

  attach(handle: Deno.PointerValue): boolean {
    return this.#dl.symbols.rde_attach(handle) === 1;
  }

  detach(handle: Deno.PointerValue): void {
    this.#dl.symbols.rde_detach(handle);
  }

  snapshot(handle: Deno.PointerValue): PointerSnapshot {
    const buf = new Uint8Array(SNAPSHOT_BYTES);
    if (!this.#dl.symbols.rde_snapshot(handle, buf)) return emptySnapshot();
    return decodeSnapshot(buf);
  }

  pollEvents(handle: Deno.PointerValue, cap = 64): NativeQueuedEvent[] {
    const buf = new Uint8Array(QUEUED_EVENT_BYTES * cap);
    const n = this.#dl.symbols.rde_poll_events(handle, buf, cap);
    if (n <= 0) return [];
    return decodeQueuedEvents(buf, n, macKeys);
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #dl in this,
      "MacosBackend",
      () => ({ os: this.os, abi: this.abiVersion }),
      inspect,
      options,
    );
  }
}

export async function loadMacos(): Promise<MacosBackend> {
  let path: string;
  try {
    path = await compileNative(macosSpec());
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        "raw-desktop-events: clang is required to build the macOS helper. " +
          "Install Xcode Command Line Tools (xcode-select --install).",
      );
    }
    throw error;
  }
  const dl = Deno.dlopen(path, SYMBOLS);
  const backend = new MacosBackend(dl);
  if (backend.abiVersion !== ABI_VERSION) {
    dl.close();
    throw new Error(
      `raw-desktop-events: native ABI ${backend.abiVersion} != ${ABI_VERSION}`,
    );
  }
  return backend;
}
