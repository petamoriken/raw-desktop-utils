import type { ChannelInterpretation } from "./types.ts";

export function silence(frames: number, channels: number): Float32Array[] {
  return Array.from({ length: channels }, () => new Float32Array(frames));
}

export function mixTo(
  dest: Float32Array[],
  source: Float32Array[],
  interpretation: ChannelInterpretation,
): void {
  if (source.length === 0 || dest.length === 0) return;
  const frames = dest[0]!.length;
  if (source.length === dest.length) {
    for (let c = 0; c < dest.length; c++) {
      const d = dest[c]!;
      const s = source[c]!;
      for (let i = 0; i < frames; i++) d[i] = (d[i] ?? 0) + (s[i] ?? 0);
    }
    return;
  }
  if (interpretation === "discrete") {
    const n = Math.min(dest.length, source.length);
    for (let c = 0; c < n; c++) {
      const d = dest[c]!;
      const s = source[c]!;
      for (let i = 0; i < frames; i++) d[i] = (d[i] ?? 0) + (s[i] ?? 0);
    }
    return;
  }
  if (source.length === 1 && dest.length === 2) {
    const s = source[0]!;
    for (const d of dest) {
      for (let i = 0; i < frames; i++) d[i] = (d[i] ?? 0) + (s[i] ?? 0);
    }
    return;
  }
  if (source.length === 2 && dest.length === 1) {
    const l = source[0]!;
    const r = source[1]!;
    const d = dest[0]!;
    for (let i = 0; i < frames; i++) {
      d[i] = (d[i] ?? 0) + 0.5 * ((l[i] ?? 0) + (r[i] ?? 0));
    }
    return;
  }
  const n = Math.min(dest.length, source.length);
  for (let c = 0; c < n; c++) {
    const d = dest[c]!;
    const s = source[c]!;
    for (let i = 0; i < frames; i++) d[i] = (d[i] ?? 0) + (s[i] ?? 0);
  }
}

export function interleave(channels: Float32Array[]): Float32Array {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const out = new Float32Array(frames * count);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      out[i * count + c] = channels[c]![i] ?? 0;
    }
  }
  return out;
}
