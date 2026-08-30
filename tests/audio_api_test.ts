import { assertEquals, assertGreater, assertThrows } from "@std/assert";
import {
  AudioBuffer,
  AudioBufferSourceNode,
  AudioContext,
  GainNode,
} from "../src/audio/mod.ts";
import { FakeAudioSink } from "../src/native/audio.ts";

Deno.test("AudioContext starts suspended with default quantum 128", () => {
  const ctx = new AudioContext({}, new FakeAudioSink());
  assertEquals(ctx.state, "suspended");
  assertEquals(ctx.renderQuantumSize, 128);
  assertEquals(ctx.sampleRate, 48000);
  assertEquals(ctx.currentTime, 0);
});

Deno.test("renderSizeHint numeric is honored", () => {
  const ctx = new AudioContext(
    { renderSizeHint: 256 },
    new FakeAudioSink(),
  );
  assertEquals(ctx.renderQuantumSize, 256);
});

Deno.test("renderSizeHint default and hardware are 128", () => {
  const a = new AudioContext(
    { renderSizeHint: "default" },
    new FakeAudioSink(),
  );
  const b = new AudioContext(
    { renderSizeHint: "hardware" },
    new FakeAudioSink(),
  );
  assertEquals(a.renderQuantumSize, 128);
  assertEquals(b.renderQuantumSize, 128);
});

Deno.test("renderSizeHint out of range throws NotSupportedError", () => {
  assertThrows(
    () => new AudioContext({ renderSizeHint: 0 }, new FakeAudioSink()),
    Error,
    "renderSizeHint",
  );
  assertThrows(
    () =>
      new AudioContext(
        { sampleRate: 48000, renderSizeHint: 6 * 48000 + 1 },
        new FakeAudioSink(),
      ),
    Error,
    "renderSizeHint",
  );
});

Deno.test("resume and close transition state", async () => {
  const ctx = new AudioContext({}, new FakeAudioSink());
  const states: string[] = [];
  ctx.addEventListener("statechange", () => states.push(ctx.state));
  await ctx.resume();
  assertEquals(ctx.state, "running");
  await ctx.suspend();
  assertEquals(ctx.state, "suspended");
  await ctx.close();
  assertEquals(ctx.state, "closed");
  assertEquals(states, ["running", "suspended", "closed"]);
});

Deno.test("connect and disconnect wire a graph", () => {
  const ctx = new AudioContext({}, new FakeAudioSink());
  const gain = new GainNode(ctx, { gain: 0.5 });
  const src = new AudioBufferSourceNode(ctx);
  const buf = new AudioBuffer({
    length: 128,
    numberOfChannels: 1,
    sampleRate: ctx.sampleRate,
  });
  src.buffer = buf;
  src.connect(gain).connect(ctx.destination);
  gain.disconnect();
  assertEquals(gain.gain.value, 0.5);
  assertEquals(src.buffer?.length, 128);
});

Deno.test("modern constructors match create* factories", () => {
  const ctx = new AudioContext({}, new FakeAudioSink());
  const a = ctx.createGain();
  const b = new GainNode(ctx);
  assertEquals(a.constructor, b.constructor);
  assertEquals(ctx.createOscillator().constructor.name, "OscillatorNode");
  assertEquals(ctx.createBuffer(1, 64, ctx.sampleRate).length, 64);
});

Deno.test("inspecting audio prototypes does not throw", () => {
  for (
    const proto of [
      AudioContext.prototype,
      AudioBuffer.prototype,
      GainNode.prototype,
      AudioBufferSourceNode.prototype,
    ]
  ) {
    Deno.inspect(proto);
  }
  const ctx = new AudioContext({}, new FakeAudioSink());
  const text = Deno.inspect(ctx);
  assertEquals(text.includes("AudioContext"), true);
  assertEquals(text.includes("#"), false);
});

Deno.test("hardware hint stays in range after resume", async () => {
  const ctx = new AudioContext(
    { renderSizeHint: "hardware" },
    new FakeAudioSink(),
  );
  await ctx.resume();
  assertGreater(ctx.renderQuantumSize, 0);
  assertEquals(ctx.renderQuantumSize, 128);
  await ctx.close();
});
