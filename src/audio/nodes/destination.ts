import { AudioNode, type GraphHost } from "../node.ts";
import type { AudioNodeOptions } from "../types.ts";

export class AudioDestinationNode extends AudioNode {
  readonly maxChannelCount: number;

  constructor(
    context: GraphHost,
    maxChannelCount = 2,
    options: AudioNodeOptions = {},
  ) {
    super(context, {
      ...options,
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: options.channelCount ?? Math.min(2, maxChannelCount),
      channelCountMode: options.channelCountMode ?? "explicit",
      tag: "AudioDestinationNode",
    });
    this.maxChannelCount = maxChannelCount;
  }

  override process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    frames: number,
  ): void {
    const src = inputs[0] ?? [];
    const dest = outputs[0] ?? [];
    const n = Math.min(src.length, dest.length);
    for (let c = 0; c < n; c++) {
      dest[c]!.set(src[c]!.subarray(0, frames));
    }
  }
}
