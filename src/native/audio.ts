import { ABI_VERSION, AUDIO_INFO_BYTES } from "./abi.ts";
import { inspectBranded, type InspectFn, kCustomInspect } from "../inspect.ts";
import { materializeLibrary, prebuiltFileName } from "./load.ts";
import { RDU_SYMBOLS, type RduLibrary } from "./symbols.ts";

export type AudioSink = {
  readonly sampleRate: number;
  readonly channels: number;
  readonly framesQueued: number;
  readonly framesCapacity: number;
  readonly framesConsumed: number;
  readonly latencyFrames: number;
  refresh(): void;
  write(interleaved: Float32Array, frames: number): number;
  pause(): void;
  resume(): void;
  close(): void;
};

let cachedLib: Promise<RduLibrary> | undefined;

function loadAudioLibrary(): Promise<RduLibrary> {
  cachedLib ??= openAudioLibrary().catch((error) => {
    cachedLib = undefined;
    throw error;
  });
  return cachedLib;
}

async function openAudioLibrary(): Promise<RduLibrary> {
  const path = await materializeHost();
  const dl = Deno.dlopen(path, RDU_SYMBOLS);
  if (dl.symbols.rdu_abi_version() !== ABI_VERSION) {
    dl.close();
    throw new Error(
      `raw-desktop-utils: native ABI ${dl.symbols.rdu_abi_version()} != ${ABI_VERSION}`,
    );
  }
  return dl;
}

async function materializeHost(): Promise<string> {
  const name = prebuiltFileName();
  if (Deno.build.os === "darwin") {
    const { darwinPrebuilt } = await import("./prebuilt/darwin.ts");
    return await materializeLibrary(darwinPrebuilt(), name);
  }
  if (Deno.build.os === "windows") {
    const { windowsPrebuilt } = await import("./prebuilt/windows.ts");
    return await materializeLibrary(windowsPrebuilt(), name);
  }
  const { linuxPrebuilt } = await import("./prebuilt/linux.ts");
  return await materializeLibrary(linuxPrebuilt(), name);
}

export class FakeAudioSink implements AudioSink {
  readonly sampleRate: number;
  readonly channels: number;
  readonly framesCapacity: number;
  readonly #recorded: number[] = [];
  #consumed = 0;
  #closed = false;

  constructor(
    options: { sampleRate?: number; channels?: number; capacity?: number } = {},
  ) {
    this.sampleRate = options.sampleRate ?? 48000;
    this.channels = options.channels ?? 2;
    this.framesCapacity = options.capacity ?? 48000;
  }

  get framesQueued(): number {
    return Math.floor(this.#recorded.length / this.channels) - this.#consumed;
  }

  get framesConsumed(): number {
    return this.#consumed;
  }

  get latencyFrames(): number {
    return 0;
  }

  get recorded(): Float32Array {
    return Float32Array.from(this.#recorded);
  }

  refresh(): void {}

  write(interleaved: Float32Array, frames: number): number {
    if (this.#closed) return 0;
    const queued = this.framesQueued;
    const room = Math.max(0, this.framesCapacity - queued);
    const n = Math.max(
      0,
      Math.min(room, frames, Math.floor(interleaved.length / this.channels)),
    );
    const samples = n * this.channels;
    for (let i = 0; i < samples; i++) this.#recorded.push(interleaved[i]!);
    return n;
  }

  pause(): void {}
  resume(): void {}

  close(): void {
    this.#closed = true;
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #closed in this,
      "FakeAudioSink",
      () => ({
        sampleRate: this.sampleRate,
        channels: this.channels,
        framesConsumed: this.#consumed,
      }),
      inspect,
      options,
    );
  }
}

export class NativeAudioSink implements AudioSink {
  readonly #dl: RduLibrary;
  readonly #handle: Deno.PointerValue;
  #sampleRate: number;
  #channels: number;
  #framesQueued = 0;
  #framesCapacity: number;
  #framesConsumed = 0;
  #latencyFrames = 0;
  #closed = false;

  constructor(dl: RduLibrary, handle: Deno.PointerValue) {
    this.#dl = dl;
    this.#handle = handle;
    this.#sampleRate = 0;
    this.#channels = 0;
    this.#framesCapacity = 0;
    this.refresh();
  }

  get sampleRate(): number {
    return this.#sampleRate;
  }
  get channels(): number {
    return this.#channels;
  }
  get framesQueued(): number {
    return this.#framesQueued;
  }
  get framesCapacity(): number {
    return this.#framesCapacity;
  }
  get framesConsumed(): number {
    return this.#framesConsumed;
  }
  get latencyFrames(): number {
    return this.#latencyFrames;
  }

  refresh(): void {
    if (this.#closed) return;
    const buf = new ArrayBuffer(AUDIO_INFO_BYTES);
    const view = new DataView(buf);
    if (!this.#dl.symbols.rdu_audio_info(this.#handle, new Uint8Array(buf))) {
      return;
    }
    this.#sampleRate = view.getUint32(0, true);
    this.#channels = view.getUint32(4, true);
    this.#framesQueued = view.getUint32(8, true);
    this.#framesCapacity = view.getUint32(12, true);
    this.#framesConsumed = Number(view.getBigUint64(16, true));
    this.#latencyFrames = view.getUint32(24, true);
  }

  write(interleaved: Float32Array, frames: number): number {
    if (this.#closed || frames <= 0) return 0;
    const n = this.#dl.symbols.rdu_audio_write(
      this.#handle,
      new Uint8Array(
        interleaved.buffer,
        interleaved.byteOffset,
        interleaved.byteLength,
      ),
      frames,
    );
    return n > 0 ? n : 0;
  }

  pause(): void {
    if (!this.#closed) this.#dl.symbols.rdu_audio_pause(this.#handle);
  }

  resume(): void {
    if (!this.#closed) this.#dl.symbols.rdu_audio_resume(this.#handle);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#dl.symbols.rdu_audio_close(this.#handle);
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #closed in this,
      "NativeAudioSink",
      () => ({
        closed: this.#closed,
        sampleRate: this.#sampleRate,
        channels: this.#channels,
        framesConsumed: this.#framesConsumed,
      }),
      inspect,
      options,
    );
  }
}

export async function openNativeAudioSink(
  sampleRate: number,
  channels: number,
  bufferFrames: number,
): Promise<NativeAudioSink | null> {
  try {
    const dl = await loadAudioLibrary();
    const handle = dl.symbols.rdu_audio_open(
      sampleRate,
      channels,
      bufferFrames,
    );
    if (!handle) return null;
    return new NativeAudioSink(dl, handle);
  } catch {
    return null;
  }
}
