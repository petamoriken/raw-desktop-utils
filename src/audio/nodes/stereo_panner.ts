import { AudioNode, type GraphHost } from "../node.ts";
import { AudioParam } from "../param.ts";
import type { AudioNodeOptions } from "../types.ts";

export type StereoPannerOptions = AudioNodeOptions & {
  pan?: number;
};

export class StereoPannerNode extends AudioNode {
  readonly pan: AudioParam;

  constructor(context: GraphHost, options: StereoPannerOptions = {}) {
    super(context, {
      ...options,
      channelCount: 2,
      channelCountMode: options.channelCountMode ?? "clamped-max",
      tag: "StereoPannerNode",
    });
    this.pan = new AudioParam({
      name: "pan",
      defaultValue: options.pan ?? 0,
      minValue: -1,
      maxValue: 1,
      automationRate: "a-rate",
    });
    if (options.pan !== undefined) this.pan.value = options.pan;
  }

  override process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    frames: number,
  ): void {
    const src = inputs[0] ?? [];
    const dest = outputs[0] ?? [];
    if (dest.length === 0) return;
    const pan = new Float32Array(frames);
    this.pan.fill(pan, this.context.currentTime, this.context.sampleRate);
    const left = dest[0]!;
    const right = dest[1] ?? dest[0]!;
    const mono = src.length < 2;
    for (let i = 0; i < frames; i++) {
      const x = Math.min(1, Math.max(-1, pan[i] ?? 0));
      const gL = Math.cos((x + 1) * Math.PI / 4);
      const gR = Math.sin((x + 1) * Math.PI / 4);
      if (mono) {
        const s = src[0]?.[i] ?? 0;
        left[i] = s * gL;
        right[i] = s * gR;
      } else {
        left[i] = (src[0]?.[i] ?? 0) * gL;
        right[i] = (src[1]?.[i] ?? 0) * gR;
      }
    }
  }
}
