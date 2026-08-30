import { inspectBranded, type InspectFn, kCustomInspect } from "../inspect.ts";
import { indexSize, invalidState } from "./errors.ts";
import { mixTo, silence } from "./mix.ts";
import type { AudioParam } from "./param.ts";
import type {
  AudioContextState,
  AudioNodeOptions,
  ChannelCountMode,
  ChannelInterpretation,
} from "./types.ts";

export type GraphHost = {
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly renderQuantumSize: number;
  readonly state: AudioContextState;
};

type NodeFan = {
  node: AudioNode;
  output: number;
  input: number;
};

type ParamFan = {
  param: AudioParam;
  output: number;
};

export class AudioNode {
  readonly context: GraphHost;
  readonly numberOfInputs: number;
  readonly numberOfOutputs: number;
  channelCount: number;
  channelCountMode: ChannelCountMode;
  channelInterpretation: ChannelInterpretation;
  readonly #outputs: NodeFan[][] = [];
  readonly #paramOutputs: ParamFan[][] = [];
  readonly #inputs: NodeFan[][] = [];
  #cachedQuantum = -1;
  #walking = false;
  #cached: Float32Array[][] = [];
  readonly #tag: string;

  constructor(
    context: GraphHost,
    options: AudioNodeOptions & {
      numberOfInputs?: number;
      numberOfOutputs?: number;
      tag?: string;
    } = {},
  ) {
    this.context = context;
    this.numberOfInputs = options.numberOfInputs ?? 1;
    this.numberOfOutputs = options.numberOfOutputs ?? 1;
    this.channelCount = options.channelCount ?? 2;
    this.channelCountMode = options.channelCountMode ?? "max";
    this.channelInterpretation = options.channelInterpretation ?? "speakers";
    this.#tag = options.tag ?? "AudioNode";
    for (let i = 0; i < this.numberOfOutputs; i++) {
      this.#outputs[i] = [];
      this.#paramOutputs[i] = [];
    }
    for (let i = 0; i < this.numberOfInputs; i++) this.#inputs[i] = [];
  }

  connect(destination: AudioNode, output?: number, input?: number): AudioNode;
  connect(destination: AudioParam, output?: number): AudioParam;
  connect(
    destination: AudioNode | AudioParam,
    output = 0,
    input = 0,
  ): AudioNode | AudioParam {
    this.#assertOpen();
    this.#checkOutput(output);
    if (destination instanceof AudioNode) {
      if (destination.context !== this.context) {
        throw invalidState("cannot connect nodes from different AudioContexts");
      }
      if (input < 0 || input >= destination.numberOfInputs) {
        throw indexSize(`input ${input} is out of range`);
      }
      const fan = { node: destination, output, input };
      if (
        !this.#outputs[output]!.some((item) =>
          item.node === destination && item.input === input
        )
      ) {
        this.#outputs[output]!.push(fan);
        destination.#inputs[input]!.push({ node: this, output, input });
      }
      return destination;
    }
    const fan = { param: destination, output };
    if (
      !this.#paramOutputs[output]!.some((item) => item.param === destination)
    ) {
      this.#paramOutputs[output]!.push(fan);
    }
    return destination;
  }

  disconnect(): void;
  disconnect(output: number): void;
  disconnect(destination: AudioNode | AudioParam): void;
  disconnect(destination: AudioNode, output: number): void;
  disconnect(destination: AudioNode, output: number, input: number): void;
  disconnect(destination: AudioParam, output: number): void;
  disconnect(
    destination?: number | AudioNode | AudioParam,
    output?: number,
    input?: number,
  ): void {
    if (destination === undefined) {
      this.#clearAll();
      return;
    }
    if (typeof destination === "number") {
      this.#checkOutput(destination);
      this.#clearOutput(destination);
      return;
    }
    if (destination instanceof AudioNode) {
      const out = output ?? 0;
      this.#checkOutput(out);
      this.#outputs[out] = this.#outputs[out]!.filter((fan) => {
        if (fan.node !== destination) return true;
        if (input !== undefined && fan.input !== input) return true;
        destination.#inputs[fan.input] = destination.#inputs[fan.input]!.filter(
          (item) => item.node !== this || item.output !== out,
        );
        return false;
      });
      return;
    }
    const out = output ?? 0;
    this.#checkOutput(out);
    this.#paramOutputs[out] = this.#paramOutputs[out]!.filter((fan) =>
      fan.param !== destination
    );
  }

  /** Pull this node's outputs for `quantum`, filling one buffer per output. */
  pull(quantum: number): Float32Array[][] {
    if (this.#cachedQuantum === quantum) return this.#cached;
    if (this.#walking) {
      return this.#blank();
    }
    this.#walking = true;
    const frames = this.context.renderQuantumSize;
    const inputs = this.#gatherInputs(quantum, frames);
    const outputs = this.#blank();
    this.process(inputs, outputs, frames);
    this.#cached = outputs;
    this.#cachedQuantum = quantum;
    this.#walking = false;
    return outputs;
  }

  process(
    _inputs: Float32Array[][],
    _outputs: Float32Array[][],
    _frames: number,
  ): void {}

  inputChannelCount(sources: Float32Array[][]): number {
    if (this.channelCountMode === "explicit") return this.channelCount;
    let max = 1;
    for (const src of sources) max = Math.max(max, src.length);
    if (this.channelCountMode === "clamped-max") {
      return Math.min(max, this.channelCount);
    }
    return Math.max(max, 1);
  }

  #gatherInputs(quantum: number, frames: number): Float32Array[][] {
    const result: Float32Array[][] = [];
    for (let i = 0; i < this.numberOfInputs; i++) {
      const fans = this.#inputs[i] ?? [];
      const sources = fans.map((fan) => {
        const pulled = fan.node.pull(quantum);
        return pulled[fan.output] ?? silence(frames, 1);
      });
      const channels = this.inputChannelCount(sources);
      const mixed = silence(frames, channels);
      for (const src of sources) {
        mixTo(mixed, src, this.channelInterpretation);
      }
      result[i] = mixed;
    }
    return result;
  }

  #blank(): Float32Array[][] {
    const frames = this.context.renderQuantumSize;
    return Array.from(
      { length: this.numberOfOutputs },
      () => silence(frames, this.channelCount),
    );
  }

  #clearAll(): void {
    for (let o = 0; o < this.numberOfOutputs; o++) this.#clearOutput(o);
  }

  #clearOutput(output: number): void {
    for (const fan of this.#outputs[output] ?? []) {
      fan.node.#inputs[fan.input] = fan.node.#inputs[fan.input]!.filter(
        (item) => item.node !== this || item.output !== output,
      );
    }
    this.#outputs[output] = [];
    this.#paramOutputs[output] = [];
  }

  #checkOutput(output: number): void {
    if (output < 0 || output >= this.numberOfOutputs) {
      throw indexSize(`output ${output} is out of range`);
    }
  }

  #assertOpen(): void {
    if (this.context.state === "closed") {
      throw invalidState("AudioContext is closed");
    }
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #tag in this,
      #tag in this ? this.#tag : "AudioNode",
      () => ({
        numberOfInputs: this.numberOfInputs,
        numberOfOutputs: this.numberOfOutputs,
        channelCount: this.channelCount,
        contextState: this.context.state,
      }),
      inspect,
      options,
    );
  }
}
