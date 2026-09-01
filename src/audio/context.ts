import { inspectBranded, type InspectFn, kCustomInspect } from "../inspect.ts";
import type { AudioSink } from "../native/audio.ts";
import { openNativeAudioSink } from "../native/audio.ts";
import { AudioBuffer } from "./buffer.ts";
import { invalidState, notSupported } from "./errors.ts";
import { AudioListener } from "./listener.ts";
import { interleave, silence } from "./mix.ts";
import { AnalyserNode } from "./nodes/analyser.ts";
import { BiquadFilterNode } from "./nodes/biquad.ts";
import { AudioBufferSourceNode } from "./nodes/buffer_source.ts";
import { AudioDestinationNode } from "./nodes/destination.ts";
import { GainNode } from "./nodes/gain.ts";
import { OscillatorNode } from "./nodes/oscillator.ts";
import { StereoPannerNode } from "./nodes/stereo_panner.ts";
import { PeriodicWave, type PeriodicWaveConstraints } from "./periodic_wave.ts";
import type {
  AudioContextLatencyCategory,
  AudioContextOptions,
  AudioContextRenderSizeCategory,
  AudioContextState,
} from "./types.ts";
import {
  DEFAULT_RENDER_QUANTUM,
  DEFAULT_SAMPLE_RATE,
  MAX_SAMPLE_RATE,
  MIN_SAMPLE_RATE,
} from "./types.ts";

export type { AudioContextOptions } from "./types.ts";

export class AudioContext extends EventTarget {
  readonly destination: AudioDestinationNode;
  readonly listener: AudioListener = new AudioListener();
  onstatechange: ((this: AudioContext, ev: Event) => void) | null = null;
  readonly #sampleRate: number;
  readonly #renderQuantumSize: number;
  readonly #latencyHint: AudioContextLatencyCategory | number;
  #state: AudioContextState = "suspended";
  #produced = 0;
  #quantum = 0;
  #sink: AudioSink | null;
  #ownSink: boolean;
  #pump: ReturnType<typeof setTimeout> | null = null;
  #resuming: Promise<void> | null = null;

  constructor(options: AudioContextOptions = {}, sink?: AudioSink) {
    super();
    const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    if (
      options.sampleRate !== undefined &&
      (!Number.isFinite(sampleRate) ||
        sampleRate < MIN_SAMPLE_RATE ||
        sampleRate > MAX_SAMPLE_RATE)
    ) {
      throw notSupported(
        `sampleRate must be in [${MIN_SAMPLE_RATE}, ${MAX_SAMPLE_RATE}]`,
      );
    }
    this.#sampleRate = sampleRate;
    this.#latencyHint = options.latencyHint ?? "interactive";
    this.#renderQuantumSize = resolveQuantum(
      options.renderSizeHint,
      sampleRate,
    );
    this.#sink = sink ?? null;
    this.#ownSink = false;
    this.destination = new AudioDestinationNode(this, 2);
  }

  get sampleRate(): number {
    return this.#sampleRate;
  }

  get currentTime(): number {
    return this.#produced / this.#sampleRate;
  }

  get state(): AudioContextState {
    return this.#state;
  }

  get renderQuantumSize(): number {
    return this.#renderQuantumSize;
  }

  get baseLatency(): number {
    return this.#renderQuantumSize / this.#sampleRate;
  }

  get outputLatency(): number {
    const sink = this.#sink;
    if (!sink) return 0;
    return (sink.latencyFrames + sink.framesQueued) / sink.sampleRate;
  }

  async resume(): Promise<void> {
    if (this.#state === "closed") throw invalidState("AudioContext is closed");
    if (this.#state === "running") return;
    this.#resuming ??= this.#doResume();
    try {
      await this.#resuming;
    } finally {
      this.#resuming = null;
    }
  }

  suspend(): Promise<void> {
    if (this.#state === "closed") throw invalidState("AudioContext is closed");
    if (this.#state !== "running") return Promise.resolve();
    this.#stopPump();
    this.#sink?.pause();
    this.#setState("suspended");
    return Promise.resolve();
  }

  close(): Promise<void> {
    if (this.#state === "closed") return Promise.resolve();
    this.#stopPump();
    if (this.#ownSink) this.#sink?.close();
    this.#sink = null;
    this.#setState("closed");
    return Promise.resolve();
  }

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): AudioBuffer {
    return new AudioBuffer({ numberOfChannels, length, sampleRate });
  }

  createBufferSource(): AudioBufferSourceNode {
    return new AudioBufferSourceNode(this);
  }

  createGain(): GainNode {
    return new GainNode(this);
  }

  createOscillator(): OscillatorNode {
    return new OscillatorNode(this);
  }

  createBiquadFilter(): BiquadFilterNode {
    return new BiquadFilterNode(this);
  }

  createAnalyser(): AnalyserNode {
    return new AnalyserNode(this);
  }

  createStereoPanner(): StereoPannerNode {
    return new StereoPannerNode(this);
  }

  createPeriodicWave(
    real: Float32Array | number[],
    imag: Float32Array | number[],
    constraints?: PeriodicWaveConstraints,
  ): PeriodicWave {
    return new PeriodicWave(this, { real, imag, ...constraints });
  }

  renderFrames(frameCount: number): Float32Array[] {
    const channels = this.destination.channelCount;
    const out = silence(frameCount, channels);
    let offset = 0;
    while (offset < frameCount) {
      const block = this.#renderQuantum();
      const n = Math.min(this.#renderQuantumSize, frameCount - offset);
      for (let c = 0; c < channels; c++) {
        out[c]!.set(block[c]!.subarray(0, n), offset);
      }
      offset += n;
    }
    return out;
  }

  async #doResume(): Promise<void> {
    if (!this.#sink) {
      const frames = latencyFrames(this.#latencyHint, this.#sampleRate);
      const sink = await openNativeAudioSink(this.#sampleRate, 2, frames);
      if (!sink) {
        throw notSupported("no audio output device");
      }
      this.#sink = sink;
      this.#ownSink = true;
    } else {
      this.#sink.resume();
    }
    this.#setState("running");
    this.#pumpOnce();
  }

  #renderQuantum(): Float32Array[] {
    const frames = this.#renderQuantumSize;
    const outputs = this.destination.pull(this.#quantum);
    this.#quantum += 1;
    this.#produced += frames;
    return outputs[0] ?? silence(frames, this.destination.channelCount);
  }

  #pumpOnce(): void {
    if (this.#state !== "running" || !this.#sink) return;
    this.#sink.refresh();
    const target = Math.max(
      this.#renderQuantumSize * 2,
      Math.floor(this.#sink.framesCapacity / 2),
    );
    while (this.#sink.framesQueued < target) {
      const block = this.#renderQuantum();
      const pcm = maybeResample(
        interleave(block),
        block.length,
        this.#sampleRate,
        this.#sink.sampleRate,
      );
      const frames = Math.floor(pcm.length / this.#sink.channels);
      if (this.#sink.write(pcm, frames) <= 0) break;
      this.#sink.refresh();
    }
    this.#schedulePump();
  }

  #schedulePump(): void {
    if (this.#pump !== null || this.#state !== "running") return;
    const ms = Math.max(
      1,
      (1000 * this.#renderQuantumSize) / this.#sampleRate / 2,
    );
    this.#pump = setTimeout(() => {
      this.#pump = null;
      this.#pumpOnce();
    }, ms);
  }

  #stopPump(): void {
    if (this.#pump !== null) {
      clearTimeout(this.#pump);
      this.#pump = null;
    }
  }

  #setState(state: AudioContextState): void {
    if (this.#state === state) return;
    this.#state = state;
    const event = new Event("statechange");
    this.dispatchEvent(event);
    this.onstatechange?.call(this, event);
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #state in this,
      "AudioContext",
      () => ({
        state: this.#state,
        sampleRate: this.#sampleRate,
        currentTime: this.currentTime,
        renderQuantumSize: this.#renderQuantumSize,
      }),
      inspect,
      options,
    );
  }
}

export function renderFrames(
  context: AudioContext,
  frameCount: number,
): Float32Array[] {
  return context.renderFrames(frameCount);
}

function resolveQuantum(
  hint: AudioContextRenderSizeCategory | number | undefined,
  sampleRate: number,
): number {
  if (hint === undefined || hint === "default" || hint === "hardware") {
    return DEFAULT_RENDER_QUANTUM;
  }
  if (typeof hint !== "number" || !Number.isInteger(hint)) {
    throw notSupported("renderSizeHint must be an integer or a category");
  }
  const max = Math.floor(6 * sampleRate);
  if (hint < 1 || hint > max) {
    throw notSupported(`renderSizeHint must be in [1, ${max}]`);
  }
  return hint;
}

function latencyFrames(
  hint: AudioContextLatencyCategory | number,
  sampleRate: number,
): number {
  if (typeof hint === "number") {
    return Math.max(256, Math.round(hint * sampleRate));
  }
  if (hint === "playback") return Math.round(0.2 * sampleRate);
  if (hint === "balanced") return Math.round(0.1 * sampleRate);
  return Math.round(0.05 * sampleRate);
}

function maybeResample(
  interleaved: Float32Array,
  channels: number,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || channels < 1) return interleaved;
  const inFrames = Math.floor(interleaved.length / channels);
  const outFrames = Math.max(1, Math.round(inFrames * toRate / fromRate));
  const out = new Float32Array(outFrames * channels);
  const step = fromRate / toRate;
  for (let i = 0; i < outFrames; i++) {
    const src = i * step;
    const i0 = Math.min(inFrames - 1, Math.floor(src));
    const i1 = Math.min(inFrames - 1, i0 + 1);
    const frac = src - i0;
    for (let c = 0; c < channels; c++) {
      const a = interleaved[i0 * channels + c] ?? 0;
      const b = interleaved[i1 * channels + c] ?? 0;
      out[i * channels + c] = a + (b - a) * frac;
    }
  }
  return out;
}
