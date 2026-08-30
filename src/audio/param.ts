import { inspectBranded, type InspectFn, kCustomInspect } from "../inspect.ts";
import { invalidState } from "./errors.ts";
import type { AutomationRate } from "./types.ts";

type EventKind =
  | "set"
  | "linear"
  | "exponential"
  | "target"
  | "curve";

type AutomationEvent = {
  kind: EventKind;
  time: number;
  value: number;
  timeConstant?: number;
  duration?: number;
  curve?: Float32Array;
};

export class AudioParam {
  readonly defaultValue: number;
  readonly minValue: number;
  readonly maxValue: number;
  automationRate: AutomationRate;
  #intrinsic: number;
  #last: number;
  #events: AutomationEvent[] = [];
  readonly #name: string;

  constructor(
    options: {
      name?: string;
      defaultValue?: number;
      minValue?: number;
      maxValue?: number;
      automationRate?: AutomationRate;
    } = {},
  ) {
    this.#name = options.name ?? "AudioParam";
    this.defaultValue = options.defaultValue ?? 0;
    this.minValue = options.minValue ?? -3.4028234663852886e38;
    this.maxValue = options.maxValue ?? 3.4028234663852886e38;
    this.automationRate = options.automationRate ?? "a-rate";
    this.#intrinsic = this.defaultValue;
    this.#last = this.defaultValue;
  }

  get value(): number {
    return this.#last;
  }

  set value(next: number) {
    this.#intrinsic = this.#clamp(next);
    this.#last = this.#intrinsic;
  }

  setValueAtTime(value: number, startTime: number): AudioParam {
    this.#insert({ kind: "set", time: this.#time(startTime), value });
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): AudioParam {
    this.#insert({ kind: "linear", time: this.#time(endTime), value });
    return this;
  }

  exponentialRampToValueAtTime(value: number, endTime: number): AudioParam {
    this.#insert({ kind: "exponential", time: this.#time(endTime), value });
    return this;
  }

  setTargetAtTime(
    target: number,
    startTime: number,
    timeConstant: number,
  ): AudioParam {
    this.#insert({
      kind: "target",
      time: this.#time(startTime),
      value: target,
      timeConstant: Math.max(timeConstant, 1e-7),
    });
    return this;
  }

  setValueCurveAtTime(
    values: Float32Array | number[],
    startTime: number,
    duration: number,
  ): AudioParam {
    if (values.length < 2) {
      throw invalidState("setValueCurveAtTime needs at least two values");
    }
    this.#insert({
      kind: "curve",
      time: this.#time(startTime),
      value: values[values.length - 1]!,
      duration: Math.max(duration, 1e-12),
      curve: Float32Array.from(values),
    });
    return this;
  }

  cancelScheduledValues(cancelTime: number): AudioParam {
    const t = this.#time(cancelTime);
    this.#events = this.#events.filter((event) => event.time < t);
    return this;
  }

  cancelAndHoldAtTime(cancelTime: number): AudioParam {
    const t = this.#time(cancelTime);
    const held = this.valueAt(t);
    this.#events = this.#events.filter((event) => event.time < t);
    this.#insert({ kind: "set", time: t, value: held });
    return this;
  }

  valueAt(time: number): number {
    const v = this.#clamp(this.#compute(time));
    this.#last = v;
    return v;
  }

  fill(out: Float32Array, startTime: number, sampleRate: number): void {
    if (this.#events.length === 0) {
      out.fill(this.#clamp(this.#intrinsic));
      this.#last = out[out.length - 1] ?? this.#intrinsic;
      return;
    }
    const dt = 1 / sampleRate;
    for (let i = 0; i < out.length; i++) {
      out[i] = this.#clamp(this.#compute(startTime + i * dt));
    }
    this.#last = out[out.length - 1] ?? this.#last;
  }

  #compute(time: number): number {
    let value = this.#intrinsic;
    let prevTime = 0;
    let prevValue = this.#intrinsic;
    for (const event of this.#events) {
      if (event.kind === "set") {
        if (time < event.time) return value;
        value = event.value;
        prevTime = event.time;
        prevValue = event.value;
        continue;
      }
      if (event.kind === "linear") {
        if (time < prevTime) return value;
        if (time >= event.time) {
          value = event.value;
          prevTime = event.time;
          prevValue = event.value;
          continue;
        }
        const t = (time - prevTime) / Math.max(event.time - prevTime, 1e-12);
        return prevValue + (event.value - prevValue) * t;
      }
      if (event.kind === "exponential") {
        if (time < prevTime) return value;
        if (prevValue === 0 || event.value === 0) {
          if (time >= event.time) {
            value = event.value;
            prevTime = event.time;
            prevValue = event.value;
            continue;
          }
          return prevValue;
        }
        if (time >= event.time) {
          value = event.value;
          prevTime = event.time;
          prevValue = event.value;
          continue;
        }
        const t = (time - prevTime) / Math.max(event.time - prevTime, 1e-12);
        return prevValue * (event.value / prevValue) ** t;
      }
      if (event.kind === "target") {
        if (time < event.time) return value;
        const tc = event.timeConstant ?? 1;
        value = event.value +
          (prevValue - event.value) * Math.exp(-(time - event.time) / tc);
        prevTime = time;
        prevValue = value;
        continue;
      }
      if (event.kind === "curve") {
        const duration = event.duration ?? 0;
        const end = event.time + duration;
        const curve = event.curve!;
        if (time < event.time) return value;
        if (time >= end) {
          value = curve[curve.length - 1]!;
          prevTime = end;
          prevValue = value;
          continue;
        }
        const pos = ((time - event.time) / duration) * (curve.length - 1);
        const i = Math.min(curve.length - 2, Math.floor(pos));
        const frac = pos - i;
        return curve[i]! + (curve[i + 1]! - curve[i]!) * frac;
      }
    }
    return value;
  }

  #insert(event: AutomationEvent): void {
    this.#events.push(event);
    this.#events.sort((a, b) => a.time - b.time);
  }

  #time(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
      throw invalidState(
        "automation time must be a non-negative finite number",
      );
    }
    return value;
  }

  #clamp(value: number): number {
    if (!Number.isFinite(value)) return this.defaultValue;
    return Math.min(this.maxValue, Math.max(this.minValue, value));
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #intrinsic in this,
      "AudioParam",
      () => ({
        name: this.#name,
        value: this.#last,
        defaultValue: this.defaultValue,
        automationRate: this.automationRate,
      }),
      inspect,
      options,
    );
  }
}
