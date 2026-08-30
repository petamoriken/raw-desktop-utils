import { indexSize } from "../errors.ts";
import { AudioNode, type GraphHost } from "../node.ts";
import type { AudioNodeOptions } from "../types.ts";

export type AnalyserOptions = AudioNodeOptions & {
  fftSize?: number;
  maxDecibels?: number;
  minDecibels?: number;
  smoothingTimeConstant?: number;
};

export class AnalyserNode extends AudioNode {
  #fftSize: number;
  minDecibels: number;
  maxDecibels: number;
  smoothingTimeConstant: number;
  #time: Float32Array;
  #write = 0;
  #prevMag: Float32Array;

  constructor(context: GraphHost, options: AnalyserOptions = {}) {
    super(context, { ...options, tag: "AnalyserNode" });
    this.#fftSize = validFft(options.fftSize ?? 2048);
    this.minDecibels = options.minDecibels ?? -100;
    this.maxDecibels = options.maxDecibels ?? -30;
    this.smoothingTimeConstant = options.smoothingTimeConstant ?? 0.8;
    this.#time = new Float32Array(this.#fftSize);
    this.#prevMag = new Float32Array(this.frequencyBinCount);
  }

  get fftSize(): number {
    return this.#fftSize;
  }

  set fftSize(value: number) {
    this.#fftSize = validFft(value);
    this.#time = new Float32Array(this.#fftSize);
    this.#prevMag = new Float32Array(this.frequencyBinCount);
    this.#write = 0;
  }

  get frequencyBinCount(): number {
    return this.#fftSize >> 1;
  }

  getFloatTimeDomainData(array: Float32Array): void {
    const n = Math.min(array.length, this.#fftSize);
    for (let i = 0; i < n; i++) {
      const idx = (this.#write + i) % this.#fftSize;
      array[i] = this.#time[idx] ?? 0;
    }
  }

  getByteTimeDomainData(array: Uint8Array): void {
    const tmp = new Float32Array(Math.min(array.length, this.#fftSize));
    this.getFloatTimeDomainData(tmp);
    for (let i = 0; i < tmp.length; i++) {
      array[i] = Math.max(
        0,
        Math.min(255, Math.floor(((tmp[i] ?? 0) + 1) * 128)),
      );
    }
  }

  getFloatFrequencyData(array: Float32Array): void {
    const bins = this.#spectrum();
    const n = Math.min(array.length, bins.length);
    for (let i = 0; i < n; i++) array[i] = bins[i]!;
  }

  getByteFrequencyData(array: Uint8Array): void {
    const bins = this.#spectrum();
    const n = Math.min(array.length, bins.length);
    const min = this.minDecibels;
    const range = this.maxDecibels - min;
    for (let i = 0; i < n; i++) {
      const db = bins[i] ?? min;
      array[i] = Math.max(
        0,
        Math.min(255, Math.floor(255 * (db - min) / Math.max(range, 1e-6))),
      );
    }
  }

  override process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    frames: number,
  ): void {
    const src = inputs[0] ?? [];
    const dest = outputs[0] ?? [];
    const mono = new Float32Array(frames);
    if (src.length === 0) {
      // silence
    } else if (src.length === 1) {
      mono.set(src[0]!.subarray(0, frames));
    } else {
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (const ch of src) s += ch[i] ?? 0;
        mono[i] = s / src.length;
      }
    }
    for (let i = 0; i < frames; i++) {
      this.#time[this.#write] = mono[i] ?? 0;
      this.#write = (this.#write + 1) % this.#fftSize;
    }
    const n = Math.min(src.length, dest.length);
    for (let c = 0; c < n; c++) dest[c]!.set(src[c]!.subarray(0, frames));
  }

  #spectrum(): Float32Array {
    const n = this.#fftSize;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    const a0 = 0.42, a1 = 0.5, a2 = 0.08;
    for (let i = 0; i < n; i++) {
      const idx = (this.#write + i) % n;
      const w = a0 - a1 * Math.cos((2 * Math.PI * i) / (n - 1)) +
        a2 * Math.cos((4 * Math.PI * i) / (n - 1));
      re[i] = (this.#time[idx] ?? 0) * w;
    }
    fft(re, im);
    const bins = this.frequencyBinCount;
    const out = new Float32Array(bins);
    const smooth = this.smoothingTimeConstant;
    for (let k = 0; k < bins; k++) {
      const mag = Math.hypot(re[k] ?? 0, im[k] ?? 0) / n;
      const db = mag > 1e-12 ? 20 * Math.log10(mag) : -1e3;
      const prev = this.#prevMag[k] ?? db;
      const mixed = smooth * prev + (1 - smooth) * db;
      this.#prevMag[k] = mixed;
      out[k] = mixed;
    }
    return out;
  }
}

function validFft(value: number): number {
  if (!Number.isInteger(value) || value < 32 || value > 32768) {
    throw indexSize("fftSize must be a power of two in [32, 32768]");
  }
  if (value & (value - 1)) {
    throw indexSize("fftSize must be a power of two");
  }
  return value;
}

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < (len >> 1); k++) {
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + (len >> 1)]! * cr - im[i + k + (len >> 1)]! * ci;
        const vi = re[i + k + (len >> 1)]! * ci + im[i + k + (len >> 1)]! * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + (len >> 1)] = ur - vr;
        im[i + k + (len >> 1)] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}
