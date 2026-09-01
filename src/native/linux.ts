import { linuxKeys } from "../keys/linux.ts";
import { inspectBranded, type InspectFn, kCustomInspect } from "../inspect.ts";
import {
  emptySnapshot,
  type NativeQueuedEvent,
  type PointerSnapshot,
} from "../types.ts";
import { ABI_VERSION, QUEUED_EVENT_BYTES, SNAPSHOT_BYTES } from "./abi.ts";
import type { NativeBackend } from "./backend.ts";
import { decodeQueuedEvents, decodeSnapshot } from "./decode.ts";
import { materializeLibrary } from "./load.ts";
import { NativeNotify } from "./notify.ts";
import { RDU_SYMBOLS } from "./symbols.ts";

const LINUX_SYMBOLS = {
  ...RDU_SYMBOLS,
  rdu_set_display: { parameters: ["pointer"], result: "i32" },
} as const;

type LinuxLibrary = Deno.DynamicLibrary<typeof LINUX_SYMBOLS>;

function cstr(text: string): Uint8Array {
  return new TextEncoder().encode(`${text}\0`);
}

export class LinuxBackend implements NativeBackend {
  readonly os = "linux";
  readonly #dl: LinuxLibrary;
  readonly #notify: NativeNotify;

  constructor(dl: LinuxLibrary) {
    this.#dl = dl;
    this.#notify = new NativeNotify(dl.symbols.rdu_set_notify);
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

  attach(handle: Deno.PointerValue, display?: Deno.PointerValue): boolean {
    if (display) this.#dl.symbols.rdu_set_display(display);
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
    return decodeQueuedEvents(buf, n, linuxKeys);
  }

  setNotify(handler: (() => void) | null): boolean {
    return this.#notify.set(handler);
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #dl in this,
      "LinuxBackend",
      () => ({ os: this.os, abi: this.abiVersion }),
      inspect,
      options,
    );
  }
}

export async function loadLinux(): Promise<LinuxBackend> {
  const path = await materializePrebuilt();
  const dl = Deno.dlopen(path, LINUX_SYMBOLS);
  const backend = new LinuxBackend(dl);
  if (backend.abiVersion !== ABI_VERSION) {
    dl.close();
    throw new Error(
      `raw-desktop-utils: native ABI ${backend.abiVersion} != ${ABI_VERSION}`,
    );
  }
  return backend;
}

async function materializePrebuilt(): Promise<string> {
  const { linuxPrebuilt } = await import("./prebuilt/linux.ts");
  return await materializeLibrary(linuxPrebuilt(), "librdu.so");
}
