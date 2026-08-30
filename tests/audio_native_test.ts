import { assertEquals } from "@std/assert";
import { AudioContext } from "../src/audio/mod.ts";
import { openNativeAudioSink } from "../src/native/audio.ts";

Deno.test({
  name: "native audio sink opens or is skipped",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const sink = await openNativeAudioSink(48000, 2, 4800);
    if (!sink) {
      return;
    }
    sink.refresh();
    assertEquals(sink.sampleRate > 0, true);
    assertEquals(sink.channels > 0, true);
    const ctx = new AudioContext({ sampleRate: sink.sampleRate }, sink);
    await ctx.resume();
    assertEquals(ctx.state, "running");
    await ctx.close();
  },
});
