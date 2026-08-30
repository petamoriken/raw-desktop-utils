import { formatInspect, type InspectFn, kCustomInspect } from "../inspect.ts";
import type { NativeQueuedEvent, PointerSnapshot } from "../types.ts";

export type NativeBackend = {
  readonly os: string;
  findWindow(title: string): Deno.PointerValue;
  findFrontWindow(): Deno.PointerValue;
  attach(handle: Deno.PointerValue): boolean;
  detach(handle: Deno.PointerValue): void;
  snapshot(handle: Deno.PointerValue): PointerSnapshot;
  pollEvents(handle: Deno.PointerValue, cap?: number): NativeQueuedEvent[];
};

export class NativeUnsupportedError extends Error {
  readonly #os: string;

  constructor(os: string, detail?: string) {
    const extra = detail ? ` ${detail}` : "";
    super(
      `raw-desktop-events: the ${os} backend is not implemented yet.${extra} ` +
        `See native/${os === "darwin" ? "macos" : os}/ for the ABI and TODOs.`,
    );
    this.name = "NativeUnsupportedError";
    this.#os = os;
  }

  get os(): string {
    return this.#os;
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return formatInspect(
      "NativeUnsupportedError",
      {
        os: this.#os,
        message: this.message,
      },
      inspect,
      options,
    );
  }
}
