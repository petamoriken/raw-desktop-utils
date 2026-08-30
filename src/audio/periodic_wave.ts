import { inspectBranded, type InspectFn, kCustomInspect } from "../inspect.ts";
import { indexSize } from "./errors.ts";
import type { GraphHost } from "./node.ts";

export type PeriodicWaveConstraints = {
  disableNormalization?: boolean;
};

export type PeriodicWaveOptions = PeriodicWaveConstraints & {
  real?: Float32Array | number[];
  imag?: Float32Array | number[];
};

const TABLE = 4096;

export class PeriodicWave {
  readonly #table: Float32Array;

  constructor(_context: GraphHost, options: PeriodicWaveOptions = {}) {
    const real = Float32Array.from(options.real ?? [0, 0]);
    const imag = Float32Array.from(options.imag ?? [0, 0]);
    const n = Math.max(real.length, imag.length);
    if (n < 2) throw indexSize("PeriodicWave needs at least two coefficients");
    this.#table = buildTable(real, imag, options.disableNormalization === true);
  }

  sample(phase: number): number {
    const x = ((phase / (2 * Math.PI)) % 1 + 1) % 1;
    const pos = x * TABLE;
    const i = Math.floor(pos) % TABLE;
    const frac = pos - Math.floor(pos);
    const a = this.#table[i]!;
    const b = this.#table[(i + 1) % TABLE]!;
    return a + (b - a) * frac;
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #table in this,
      "PeriodicWave",
      () => ({ length: this.#table.length }),
      inspect,
      options,
    );
  }
}

function buildTable(
  real: Float32Array,
  imag: Float32Array,
  disableNormalization: boolean,
): Float32Array {
  const n = Math.max(real.length, imag.length);
  const table = new Float32Array(TABLE);
  let peak = 0;
  for (let i = 0; i < TABLE; i++) {
    const phase = (2 * Math.PI * i) / TABLE;
    let s = 0;
    for (let k = 1; k < n; k++) {
      const re = real[k] ?? 0;
      const im = imag[k] ?? 0;
      s += re * Math.cos(k * phase) - im * Math.sin(k * phase);
    }
    table[i] = s;
    peak = Math.max(peak, Math.abs(s));
  }
  if (!disableNormalization && peak > 0) {
    for (let i = 0; i < TABLE; i++) table[i] = table[i]! / peak;
  }
  return table;
}
