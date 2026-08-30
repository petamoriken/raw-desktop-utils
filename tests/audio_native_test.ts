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
    try {
      sink.refresh();
      assertEquals(sink.sampleRate > 0, true);
      assertEquals(sink.channels > 0, true);
      const ctx = new AudioContext({ sampleRate: sink.sampleRate }, sink);
      await ctx.resume();
      assertEquals(ctx.state, "running");
      await ctx.close();
    } finally {
      // The context did not open this sink, so it will not close it. Leaving
      // the device running takes the process down: Deno unloads the library at
      // isolate teardown while the audio callback is still inside it.
      sink.close();
    }
  },
});
