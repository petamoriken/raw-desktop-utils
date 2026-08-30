import { inspectBranded, type InspectFn, kCustomInspect } from "../inspect.ts";
import { indexSize, notSupported } from "./errors.ts";
import {
  type AudioBufferOptions,
  MAX_CHANNELS,
  MAX_SAMPLE_RATE,
  MIN_SAMPLE_RATE,
} from "./types.ts";

export class AudioBuffer {
  readonly #sampleRate: number;
  readonly #length: number;
  readonly #channels: Float32Array[];

  constructor(options: AudioBufferOptions) {
    const sampleRate = options.sampleRate;
    const length = options.length;
    const numberOfChannels = options.numberOfChannels ?? 1;
    if (
      !Number.isFinite(sampleRate) ||
      sampleRate < MIN_SAMPLE_RATE ||
      sampleRate > MAX_SAMPLE_RATE
    ) {
      throw notSupported(
        `AudioBuffer sampleRate must be in [${MIN_SAMPLE_RATE}, ${MAX_SAMPLE_RATE}]`,
      );
    }
    if (!Number.isInteger(length) || length < 1) {
      throw notSupported("AudioBuffer length must be a positive integer");
    }
    if (
      !Number.isInteger(numberOfChannels) ||
      numberOfChannels < 1 ||
      numberOfChannels > MAX_CHANNELS
    ) {
      throw notSupported(
        `AudioBuffer numberOfChannels must be in [1, ${MAX_CHANNELS}]`,
      );
    }
    this.#sampleRate = sampleRate;
    this.#length = length;
    this.#channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }

  get sampleRate(): number {
    return this.#sampleRate;
  }

  get length(): number {
    return this.#length;
  }

  get duration(): number {
    return this.#length / this.#sampleRate;
  }

  get numberOfChannels(): number {
    return this.#channels.length;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.#channels[channel];
    if (!data) throw indexSize(`channel ${channel} is out of range`);
    return data;
  }

  copyFromChannel(
    destination: Float32Array,
    channelNumber: number,
    bufferOffset = 0,
  ): void {
    const src = this.getChannelData(channelNumber);
    const start = Math.max(0, bufferOffset | 0);
    const n = Math.min(destination.length, src.length - start);
    if (n > 0) destination.set(src.subarray(start, start + n));
  }

  copyToChannel(
    source: Float32Array,
    channelNumber: number,
    bufferOffset = 0,
  ): void {
    const dest = this.getChannelData(channelNumber);
    const start = Math.max(0, bufferOffset | 0);
    const n = Math.min(source.length, dest.length - start);
    if (n > 0) dest.set(source.subarray(0, n), start);
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #length in this,
      "AudioBuffer",
      () => ({
        length: this.#length,
        numberOfChannels: this.#channels.length,
        sampleRate: this.#sampleRate,
        duration: this.duration,
      }),
      inspect,
      options,
    );
  }
}
