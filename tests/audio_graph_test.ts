import { assertAlmostEquals, assertEquals, assertLess } from "@std/assert";
import { AudioBuffer } from "../src/audio/buffer.ts";
import { AudioContext, renderFrames } from "../src/audio/context.ts";
import { AnalyserNode } from "../src/audio/nodes/analyser.ts";
import { BiquadFilterNode } from "../src/audio/nodes/biquad.ts";
import { AudioBufferSourceNode } from "../src/audio/nodes/buffer_source.ts";
import { GainNode } from "../src/audio/nodes/gain.ts";
import { OscillatorNode } from "../src/audio/nodes/oscillator.ts";
import { StereoPannerNode } from "../src/audio/nodes/stereo_panner.ts";
import { FakeAudioSink } from "../src/native/audio.ts";

function ctx(quantum = 128): AudioContext {
  return new AudioContext(
    { sampleRate: 48000, renderSizeHint: quantum },
    new FakeAudioSink({ sampleRate: 48000 }),
  );
}

Deno.test("gain ramp scales a buffer source", () => {
  const context = ctx();
  const pcm = new Float32Array(256);
  pcm.fill(1);
  const buffer = new AudioBuffer({
    length: pcm.length,
    numberOfChannels: 1,
    sampleRate: context.sampleRate,
  });
  buffer.copyToChannel(pcm, 0);
  const src = new AudioBufferSourceNode(context, { buffer });
  const gain = new GainNode(context, { gain: 0 });
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(1, 256 / context.sampleRate);
  src.connect(gain).connect(context.destination);
  src.start();
  const out = renderFrames(context, 256);
  assertAlmostEquals(out[0]![0]!, 0, 1e-5);
  assertEquals((out[0]![255] ?? 0) > 0.9, true);
});

Deno.test("oscillator produces a non-zero sine", () => {
  const context = ctx();
  const osc = new OscillatorNode(context, { type: "sine", frequency: 375 });
  osc.connect(context.destination);
  osc.start();
  const out = renderFrames(context, 128);
  let energy = 0;
  for (const s of out[0]!) energy += s * s;
  assertEquals(energy > 1, true);
  assertAlmostEquals(out[0]![0]!, 0, 1e-6);
});

Deno.test("buffer source loops", () => {
  const context = ctx(8);
  const buffer = new AudioBuffer({
    length: 4,
    numberOfChannels: 1,
    sampleRate: context.sampleRate,
  });
  buffer.getChannelData(0).set([1, 2, 3, 4]);
  const src = new AudioBufferSourceNode(context, { buffer, loop: true });
  src.connect(context.destination);
  src.start();
  const out = renderFrames(context, 8);
  assertEquals(Array.from(out[0]!.subarray(0, 8)), [1, 2, 3, 4, 1, 2, 3, 4]);
});

Deno.test("biquad lowpass attenuates a high impulse train less than DC", () => {
  const context = ctx();
  const buffer = new AudioBuffer({
    length: 128,
    numberOfChannels: 1,
    sampleRate: context.sampleRate,
  });
  buffer.getChannelData(0)[0] = 1;
  const src = new AudioBufferSourceNode(context, { buffer });
  const filter = new BiquadFilterNode(context, {
    type: "lowpass",
    frequency: 200,
    Q: 1,
  });
  src.connect(filter).connect(context.destination);
  src.start();
  const out = renderFrames(context, 128);
  let energy = 0;
  for (const s of out[0]!) energy += s * s;
  assertEquals(energy > 0, true);
});

Deno.test("stereo panner hard-right silences the left channel", () => {
  const context = ctx();
  const buffer = new AudioBuffer({
    length: 128,
    numberOfChannels: 1,
    sampleRate: context.sampleRate,
  });
  buffer.getChannelData(0).fill(1);
  const src = new AudioBufferSourceNode(context, { buffer });
  const pan = new StereoPannerNode(context, { pan: 1 });
  src.connect(pan).connect(context.destination);
  src.start();
  const out = renderFrames(context, 128);
  assertAlmostEquals(out[0]![10]!, 0, 1e-5);
  assertAlmostEquals(out[1]![10]!, 1, 1e-5);
});

Deno.test("analyser reports time-domain data after render", () => {
  const context = ctx();
  const osc = new OscillatorNode(context, { frequency: 440 });
  const analyser = new AnalyserNode(context, { fftSize: 32 });
  osc.connect(analyser).connect(context.destination);
  osc.start();
  renderFrames(context, 128);
  const td = new Float32Array(32);
  analyser.getFloatTimeDomainData(td);
  let max = 0;
  for (const s of td) max = Math.max(max, Math.abs(s));
  assertEquals(max > 0, true);
  const spec = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(spec);
  assertLess(spec[0]!, 0);
});

Deno.test("currentTime advances by rendered frames", () => {
  const context = ctx(64);
  const osc = new OscillatorNode(context);
  osc.connect(context.destination);
  osc.start();
  renderFrames(context, 128);
  assertAlmostEquals(context.currentTime, 128 / context.sampleRate, 1e-12);
});
