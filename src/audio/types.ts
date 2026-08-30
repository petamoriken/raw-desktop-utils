export type AudioContextState = "suspended" | "running" | "closed";
export type AudioContextLatencyCategory =
  | "interactive"
  | "balanced"
  | "playback";
export type AudioContextRenderSizeCategory = "default" | "hardware";
export type ChannelCountMode = "max" | "clamped-max" | "explicit";
export type ChannelInterpretation = "speakers" | "discrete";
export type AutomationRate = "a-rate" | "k-rate";
export type OscillatorType =
  | "sine"
  | "square"
  | "sawtooth"
  | "triangle"
  | "custom";
export type BiquadFilterType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "lowshelf"
  | "highshelf"
  | "peaking"
  | "notch"
  | "allpass";
export type DistanceModelType = "linear" | "inverse" | "exponential";
export type PanningModelType = "equalpower" | "HRTF";

export const DEFAULT_RENDER_QUANTUM = 128;
export const DEFAULT_SAMPLE_RATE = 48000;
export const MIN_SAMPLE_RATE = 3000;
export const MAX_SAMPLE_RATE = 768000;
export const MAX_CHANNELS = 32;

export type AudioContextOptions = {
  latencyHint?: AudioContextLatencyCategory | number;
  sampleRate?: number;
  renderSizeHint?: AudioContextRenderSizeCategory | number;
};

export type AudioBufferOptions = {
  length: number;
  numberOfChannels?: number;
  sampleRate: number;
};

export type AudioNodeOptions = {
  channelCount?: number;
  channelCountMode?: ChannelCountMode;
  channelInterpretation?: ChannelInterpretation;
};
