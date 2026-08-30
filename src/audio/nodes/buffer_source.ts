import { invalidState } from "../errors.ts";
import type { AudioBuffer } from "../buffer.ts";
import { AudioNode, type GraphHost } from "../node.ts";
import { AudioParam } from "../param.ts";
import type { AudioNodeOptions } from "../types.ts";

export type AudioBufferSourceOptions = AudioNodeOptions & {
  buffer?: AudioBuffer | null;
  detune?: number;
  loop?: boolean;
  loopEnd?: number;
  loopStart?: number;
  playbackRate?: number;
};

export class AudioBufferSourceNode extends AudioNode {
  buffer: AudioBuffer | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: AudioParam;
  readonly detune: AudioParam;
  #started = false;
  #stopped = false;
  #startTime = 0;
  #stopTime = Number.POSITIVE_INFINITY;
  #offset = 0;
  #duration = Number.POSITIVE_INFINITY;
  #frame = 0;
  #ended = false;
  onended: ((this: AudioBufferSourceNode, ev: Event) => void) | null = null;

  constructor(context: GraphHost, options: AudioBufferSourceOptions = {}) {
    super(context, {
      ...options,
      numberOfInputs: 0,
      numberOfOutputs: 1,
      tag: "AudioBufferSourceNode",
    });
    this.buffer = options.buffer ?? null;
    this.loop = options.loop ?? false;
    this.loopStart = options.loopStart ?? 0;
    this.loopEnd = options.loopEnd ?? 0;
    this.playbackRate = new AudioParam({
      name: "playbackRate",
      defaultValue: options.playbackRate ?? 1,
      automationRate: "a-rate",
    });
    this.detune = new AudioParam({
      name: "detune",
      defaultValue: options.detune ?? 0,
      automationRate: "a-rate",
    });
    if (options.playbackRate !== undefined) {
      this.playbackRate.value = options.playbackRate;
    }
    if (options.detune !== undefined) this.detune.value = options.detune;
  }

  start(when = 0, offset = 0, duration?: number): void {
    if (this.#started) {
      throw invalidState("AudioBufferSourceNode already started");
    }
    this.#started = true;
    this.#startTime = Math.max(when, this.context.currentTime);
    this.#offset = Math.max(0, offset);
    if (duration !== undefined) this.#duration = Math.max(0, duration);
    this.#frame = this.#offset *
      (this.buffer?.sampleRate ?? this.context.sampleRate);
  }

  stop(when = 0): void {
    if (!this.#started) {
      throw invalidState("AudioBufferSourceNode has not been started");
    }
    if (this.#stopped) {
      throw invalidState("AudioBufferSourceNode already stopped");
    }
    this.#stopped = true;
    this.#stopTime = Math.max(when, this.#startTime);
  }

  override process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    frames: number,
  ): void {
    const dest = outputs[0] ?? [];
    const buf = this.buffer;
    if (!buf || dest.length === 0) return;
    const sr = this.context.sampleRate;
    const t0 = this.context.currentTime;
    const rate = new Float32Array(frames);
    const detune = new Float32Array(frames);
    this.playbackRate.fill(rate, t0, sr);
    this.detune.fill(detune, t0, sr);
    const ratio = buf.sampleRate / sr;
    const loopStart = this.#loopStartFrames(buf);
    const loopEnd = this.#loopEndFrames(buf);
    const endFrame = this.#duration === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : this.#offset * buf.sampleRate + this.#duration * buf.sampleRate;
    let ended = false;
    for (let i = 0; i < frames; i++) {
      const time = t0 + i / sr;
      if (!this.#started || time < this.#startTime || time >= this.#stopTime) {
        for (const ch of dest) ch[i] = 0;
        if (this.#started && time >= this.#stopTime) ended = true;
        continue;
      }
      if (this.#frame >= buf.length && !this.loop) {
        for (const ch of dest) ch[i] = 0;
        ended = true;
        continue;
      }
      if (this.#frame >= endFrame) {
        for (const ch of dest) ch[i] = 0;
        ended = true;
        continue;
      }
      const pos = this.#frame;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const i1 = i0 + 1;
      for (let c = 0; c < dest.length; c++) {
        const src = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
        const a = src[i0] ?? 0;
        const b = src[Math.min(i1, src.length - 1)] ?? 0;
        dest[c]![i] = a + (b - a) * frac;
      }
      const speed = (rate[i] ?? 1) * 2 ** ((detune[i] ?? 0) / 1200) * ratio;
      this.#frame += speed;
      if (this.loop && this.#frame >= loopEnd) {
        const span = Math.max(loopEnd - loopStart, 1);
        this.#frame = loopStart + ((this.#frame - loopStart) % span);
      }
    }
    if (ended && !this.#ended) {
      this.#ended = true;
      const event = new Event("ended");
      queueMicrotask(() => this.onended?.call(this, event));
    }
  }

  #loopStartFrames(buf: AudioBuffer): number {
    if (!this.loop) return 0;
    const start = this.loopStart > 0 ? this.loopStart * buf.sampleRate : 0;
    return Math.min(Math.max(start, 0), buf.length);
  }

  #loopEndFrames(buf: AudioBuffer): number {
    if (!this.loop) return buf.length;
    const end = this.loopEnd > 0 ? this.loopEnd * buf.sampleRate : buf.length;
    return Math.min(Math.max(end, this.#loopStartFrames(buf) + 1), buf.length);
  }
}
