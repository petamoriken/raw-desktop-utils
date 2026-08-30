import { inspectBranded, type InspectFn, kCustomInspect } from "../inspect.ts";
import { windowsKeys } from "../keys/windows.ts";
import {
  emptySnapshot,
  type NativeQueuedEvent,
  type PointerSnapshot,
} from "../types.ts";
import { ABI_VERSION, QUEUED_EVENT_BYTES, SNAPSHOT_BYTES } from "./abi.ts";
import type { NativeBackend } from "./backend.ts";
import { decodeQueuedEvents, decodeSnapshot } from "./decode.ts";
import { materializeLibrary } from "./load.ts";
import { RDU_SYMBOLS, type RduLibrary } from "./symbols.ts";

function cstr(text: string): Uint8Array {
  return new TextEncoder().encode(`${text}\0`);
}

export class WindowsBackend implements NativeBackend {
  readonly os = "windows";
  readonly #dl: RduLibrary;

  constructor(dl: RduLibrary) {
    this.#dl = dl;
  }

  get abiVersion(): number {
    return this.#dl.symbols.rdu_abi_version();
  }

  findWindow(title: string): Deno.PointerValue {
    return this.#dl.symbols.rdu_find_window(cstr(title));
  }

  findFrontWindow(): Deno.PointerValue {
    return this.#dl.symbols.rdu_find_front_window();
  }

  attach(handle: Deno.PointerValue, _display?: Deno.PointerValue): boolean {
    return this.#dl.symbols.rdu_attach(handle) === 1;
  }

  detach(handle: Deno.PointerValue): void {
    this.#dl.symbols.rdu_detach(handle);
  }

  snapshot(handle: Deno.PointerValue): PointerSnapshot {
    const buf = new Uint8Array(SNAPSHOT_BYTES);
    if (!this.#dl.symbols.rdu_snapshot(handle, buf)) return emptySnapshot();
    return decodeSnapshot(buf);
  }

  pollEvents(handle: Deno.PointerValue, cap = 64): NativeQueuedEvent[] {
    const buf = new Uint8Array(QUEUED_EVENT_BYTES * cap);
    const n = this.#dl.symbols.rdu_poll_events(handle, buf, cap);
    if (n <= 0) return [];
    return decodeQueuedEvents(buf, n, windowsKeys);
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #dl in this,
      "WindowsBackend",
      () => ({ os: this.os, abi: this.abiVersion }),
      inspect,
      options,
    );
  }
}

export async function loadWindows(): Promise<WindowsBackend> {
  const path = await materializePrebuilt();
  const dl = Deno.dlopen(path, RDU_SYMBOLS);
  const backend = new WindowsBackend(dl);
  if (backend.abiVersion !== ABI_VERSION) {
    dl.close();
    throw new Error(
      `raw-desktop-utils: native ABI ${backend.abiVersion} != ${ABI_VERSION}`,
    );
  }
  return backend;
}

async function materializePrebuilt(): Promise<string> {
  const { windowsPrebuilt } = await import("./prebuilt/windows.ts");
  return await materializeLibrary(windowsPrebuilt(), "rdu.dll");
}
