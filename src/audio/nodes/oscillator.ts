import { invalidState } from "../errors.ts";
import { AudioNode, type GraphHost } from "../node.ts";
import { AudioParam } from "../param.ts";
import type { PeriodicWave } from "../periodic_wave.ts";
import type { AudioNodeOptions, OscillatorType } from "../types.ts";

export type OscillatorOptions = AudioNodeOptions & {
  type?: OscillatorType;
  frequency?: number;
  detune?: number;
  periodicWave?: PeriodicWave;
};

export class OscillatorNode extends AudioNode {
  readonly frequency: AudioParam;
  readonly detune: AudioParam;
  #type: OscillatorType;
  #wave: PeriodicWave | null;
  #started = false;
  #stopped = false;
  #startTime = 0;
  #stopTime = Number.POSITIVE_INFINITY;
  #phase = 0;
  #ended = false;
  onended: ((this: OscillatorNode, ev: Event) => void) | null = null;

  constructor(context: GraphHost, options: OscillatorOptions = {}) {
    super(context, {
      ...options,
      numberOfInputs: 0,
      numberOfOutputs: 1,
      tag: "OscillatorNode",
    });
    this.#type = options.type ?? "sine";
    this.#wave = options.periodicWave ?? null;
    if (this.#wave) this.#type = "custom";
    if (this.#type === "custom" && !this.#wave) {
      throw invalidState("custom oscillator requires a PeriodicWave");
    }
    this.frequency = new AudioParam({
      name: "frequency",
      defaultValue: options.frequency ?? 440,
      minValue: -context.sampleRate / 2,
      maxValue: context.sampleRate / 2,
      automationRate: "a-rate",
    });
    this.detune = new AudioParam({
      name: "detune",
      defaultValue: options.detune ?? 0,
      automationRate: "a-rate",
    });
    if (options.frequency !== undefined) {
      this.frequency.value = options.frequency;
    }
    if (options.detune !== undefined) this.detune.value = options.detune;
  }

  get type(): OscillatorType {
    return this.#type;
  }

  set type(value: OscillatorType) {
    if (value === "custom") {
      throw invalidState("set PeriodicWave via setPeriodicWave()");
    }
    this.#type = value;
    this.#wave = null;
  }

  setPeriodicWave(wave: PeriodicWave): void {
    this.#wave = wave;
    this.#type = "custom";
  }

  start(when = 0): void {
    if (this.#started) throw invalidState("OscillatorNode already started");
    this.#started = true;
    this.#startTime = Math.max(when, this.context.currentTime);
  }

  stop(when = 0): void {
    if (!this.#started) {
      throw invalidState("OscillatorNode has not been started");
    }
    if (this.#stopped) throw invalidState("OscillatorNode already stopped");
    this.#stopped = true;
    this.#stopTime = Math.max(when, this.#startTime);
  }

  override process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    frames: number,
  ): void {
    const dest = outputs[0] ?? [];
    if (dest.length === 0) return;
    const sr = this.context.sampleRate;
    const t0 = this.context.currentTime;
    const freq = new Float32Array(frames);
    const detune = new Float32Array(frames);
    this.frequency.fill(freq, t0, sr);
    this.detune.fill(detune, t0, sr);
    const left = dest[0]!;
    for (let i = 0; i < frames; i++) {
      const time = t0 + i / sr;
      if (!this.#started || time < this.#startTime || time >= this.#stopTime) {
        left[i] = 0;
        if (this.#started && !this.#ended && time >= this.#stopTime) {
          this.#ended = true;
          this.#emitEnded();
        }
        continue;
      }
      const f = (freq[i] ?? 440) * 2 ** ((detune[i] ?? 0) / 1200);
      left[i] = this.#sample();
      this.#phase += (2 * Math.PI * f) / sr;
      if (this.#phase > 2 * Math.PI * 64) this.#phase %= 2 * Math.PI;
    }
    for (let c = 1; c < dest.length; c++) dest[c]!.set(left);
  }

  #sample(): number {
    const p = this.#phase;
    switch (this.#type) {
      case "square":
        return (p % (2 * Math.PI)) < Math.PI ? 1 : -1;
      case "sawtooth":
        return ((p / Math.PI) % 2) - 1;
      case "triangle": {
        const x = ((p / (2 * Math.PI)) % 1 + 1) % 1;
        return 1 - 4 * Math.abs(x - 0.5);
      }
      case "custom":
        return this.#wave?.sample(p) ?? 0;
      default:
        return Math.sin(p);
    }
  }

  #emitEnded(): void {
    const event = new Event("ended");
    queueMicrotask(() => {
      this.onended?.call(this, event);
    });
  }
}
