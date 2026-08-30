/**
 * Utilities for `deno desktop` raw windows: attach an input session,
 * poll OS pointer and key events as DOM events, and drive the loop
 * with `requestAnimationFrame`. Also a browser-shaped Web Audio subset
 * (`AudioContext` and nodes) that does not need a window.
 */
export { attach, InputSession, Screen } from "./src/session.ts";
export type { FrameRequestCallback, ScreenEventMap } from "./src/session.ts";
export type { InputSessionEventMap } from "./src/event_map.ts";
export {
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  UIEvent,
  WheelEvent,
} from "./src/events.ts";
export type {
  KeyboardEventInit,
  MouseEventInit,
  PointerEventInit,
  UIEventInit,
  WheelEventInit,
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
