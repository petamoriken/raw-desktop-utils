import { AudioNode, type GraphHost } from "../node.ts";
import { AudioParam } from "../param.ts";
import type { AudioNodeOptions, BiquadFilterType } from "../types.ts";

export type BiquadFilterOptions = AudioNodeOptions & {
  type?: BiquadFilterType;
  Q?: number;
  detune?: number;
  frequency?: number;
  gain?: number;
};

export class BiquadFilterNode extends AudioNode {
  type: BiquadFilterType;
  readonly frequency: AudioParam;
  readonly detune: AudioParam;
  readonly Q: AudioParam;
  readonly gain: AudioParam;
  #x1 = 0;
  #x2 = 0;
  #y1 = 0;
  #y2 = 0;

  constructor(context: GraphHost, options: BiquadFilterOptions = {}) {
    super(context, { ...options, tag: "BiquadFilterNode" });
    this.type = options.type ?? "lowpass";
    this.frequency = new AudioParam({
      name: "frequency",
      defaultValue: options.frequency ?? 350,
      minValue: 0,
      maxValue: context.sampleRate / 2,
      automationRate: "a-rate",
    });
    this.detune = new AudioParam({
      name: "detune",
      defaultValue: options.detune ?? 0,
      automationRate: "a-rate",
    });
    this.Q = new AudioParam({
      name: "Q",
      defaultValue: options.Q ?? 1,
      automationRate: "a-rate",
    });
    this.gain = new AudioParam({
      name: "gain",
      defaultValue: options.gain ?? 0,
      automationRate: "a-rate",
    });
    if (options.frequency !== undefined) {
      this.frequency.value = options.frequency;
    }
    if (options.detune !== undefined) this.detune.value = options.detune;
    if (options.Q !== undefined) this.Q.value = options.Q;
    if (options.gain !== undefined) this.gain.value = options.gain;
  }

  getFrequencyResponse(
    frequencyHz: Float32Array,
    magResponse: Float32Array,
    phaseResponse: Float32Array,
  ): void {
    const n = Math.min(
      frequencyHz.length,
      magResponse.length,
      phaseResponse.length,
    );
    const sr = this.context.sampleRate;
    const freq = this.frequency.value * 2 ** (this.detune.value / 1200);
    const coef = cookbook(
      this.type,
      freq,
      this.Q.value,
      this.gain.value,
      sr,
    );
    for (let i = 0; i < n; i++) {
      const w = 2 * Math.PI * (frequencyHz[i] ?? 0) / sr;
      const z1r = Math.cos(-w);
      const z1i = Math.sin(-w);
      const z2r = Math.cos(-2 * w);
      const z2i = Math.sin(-2 * w);
      const nr = coef.b0 + coef.b1 * z1r + coef.b2 * z2r;
      const ni = coef.b1 * z1i + coef.b2 * z2i;
      const dr = 1 + coef.a1 * z1r + coef.a2 * z2r;
      const di = coef.a1 * z1i + coef.a2 * z2i;
      const den = dr * dr + di * di;
      const hr = (nr * dr + ni * di) / den;
      const hi = (ni * dr - nr * di) / den;
      magResponse[i] = Math.hypot(hr, hi);
      phaseResponse[i] = Math.atan2(hi, hr);
    }
  }

  override process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    frames: number,
  ): void {
    const src = inputs[0]?.[0];
    const dest = outputs[0];
    if (!src || !dest?.[0]) return;
    const sr = this.context.sampleRate;
    const t0 = this.context.currentTime;
    const freq = new Float32Array(frames);
    const detune = new Float32Array(frames);
    const q = new Float32Array(frames);
    const gain = new Float32Array(frames);
    this.frequency.fill(freq, t0, sr);
    this.detune.fill(detune, t0, sr);
    this.Q.fill(q, t0, sr);
    this.gain.fill(gain, t0, sr);
    const out = dest[0]!;
    let x1 = this.#x1;
    let x2 = this.#x2;
    let y1 = this.#y1;
    let y2 = this.#y2;
    for (let i = 0; i < frames; i++) {
      const f = (freq[i] ?? 350) * 2 ** ((detune[i] ?? 0) / 1200);
      const c = cookbook(this.type, f, q[i] ?? 1, gain[i] ?? 0, sr);
      const x0 = src[i] ?? 0;
      const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      out[i] = y0;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
    this.#x1 = x1;
    this.#x2 = x2;
    this.#y1 = y1;
    this.#y2 = y2;
    for (let c = 1; c < dest.length; c++) dest[c]!.set(out);
  }
}

type Coef = { b0: number; b1: number; b2: number; a1: number; a2: number };

function cookbook(
  type: BiquadFilterType,
  frequency: number,
  Q: number,
  gainDb: number,
  sampleRate: number,
): Coef {
  const nyquist = sampleRate / 2;
  const f = Math.min(Math.max(frequency, 1), nyquist - 1);
  const w0 = 2 * Math.PI * f / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = 10 ** (gainDb / 40);
  const alpha = sin / (2 * Math.max(Q, 1e-6));
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case "highpass":
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "bandpass":
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "notch":
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "allpass":
      b0 = 1 - alpha;
      b1 = -2 * cos;
      b2 = 1 + alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "peaking":
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    case "lowshelf": {
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cos + twoSqrtAAlpha);
      b1 = 2 * A * ((A - 1) - (A + 1) * cos);
      b2 = A * ((A + 1) - (A - 1) * cos - twoSqrtAAlpha);
      a0 = (A + 1) + (A - 1) * cos + twoSqrtAAlpha;
      a1 = -2 * ((A - 1) + (A + 1) * cos);
      a2 = (A + 1) + (A - 1) * cos - twoSqrtAAlpha;
      break;
    }
    case "highshelf": {
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cos + twoSqrtAAlpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cos);
      b2 = A * ((A + 1) + (A - 1) * cos - twoSqrtAAlpha);
      a0 = (A + 1) - (A - 1) * cos + twoSqrtAAlpha;
      a1 = 2 * ((A - 1) - (A + 1) * cos);
      a2 = (A + 1) - (A - 1) * cos - twoSqrtAAlpha;
      break;
    }
    default:
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
