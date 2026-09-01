/** Input session + DOM-shaped events for `deno desktop` raw windows, and a standalone Web Audio subset. */
export { attach, InputSession, Screen } from "./src/session.ts";
export type { FrameRequestCallback, ScreenEventMap } from "./src/session.ts";
export type { InputSessionEventMap } from "./src/event_map.ts";
export {
  CompositionEvent,
  MouseEvent,
  PointerEvent,
  UIEvent,
} from "./src/events.ts";
export type {
  CompositionEventInit,
  MouseEventInit,
  PointerEventInit,
  UIEventInit,
} from "./src/events.ts";
export type {
  AttachOptions,
  DesktopWindow,
  ScreenMetrics,
  WindowMetrics,
} from "./src/types.ts";
export {
  AnalyserNode,
  AudioBuffer,
  AudioBufferSourceNode,
  AudioContext,
  AudioDestinationNode,
  AudioListener,
  AudioNode,
  AudioParam,
  BiquadFilterNode,
  GainNode,
  OscillatorNode,
  PeriodicWave,
  StereoPannerNode,
} from "./src/audio/mod.ts";
export type {
  AnalyserOptions,
  AudioBufferSourceOptions,
  AudioContextLatencyCategory,
  AudioContextOptions,
  AudioContextRenderSizeCategory,
  AudioContextState,
  AudioNodeOptions,
  AutomationRate,
  BiquadFilterOptions,
  BiquadFilterType,
  ChannelCountMode,
  ChannelInterpretation,
  GainOptions,
  OscillatorOptions,
  OscillatorType,
  PeriodicWaveConstraints,
  PeriodicWaveOptions,
  StereoPannerOptions,
} from "./src/audio/mod.ts";
