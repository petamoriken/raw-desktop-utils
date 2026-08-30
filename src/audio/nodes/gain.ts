import { AudioNode, type GraphHost } from "../node.ts";
import { AudioParam } from "../param.ts";
import type { AudioNodeOptions } from "../types.ts";

export type GainOptions = AudioNodeOptions & {
  gain?: number;
};

export class GainNode extends AudioNode {
  readonly gain: AudioParam;

  constructor(context: GraphHost, options: GainOptions = {}) {
    super(context, { ...options, tag: "GainNode" });
    this.gain = new AudioParam({
      name: "gain",
      defaultValue: options.gain ?? 1,
      automationRate: "a-rate",
    });
    if (options.gain !== undefined) this.gain.value = options.gain;
  }

  override process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    frames: number,
  ): void {
    const src = inputs[0] ?? [];
    const dest = outputs[0] ?? [];
    const g = new Float32Array(frames);
    this.gain.fill(g, this.context.currentTime, this.context.sampleRate);
    const n = Math.min(src.length, dest.length);
    for (let c = 0; c < n; c++) {
      const s = src[c]!;
      const d = dest[c]!;
      for (let i = 0; i < frames; i++) d[i] = (s[i] ?? 0) * (g[i] ?? 0);
    }
  }
}
