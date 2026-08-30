import { assertEquals, assertRejects } from "@std/assert";
import { NativeUnsupportedError } from "../src/native/backend.ts";
import { attach as attachLinux } from "../src/platforms/linux.ts";
import { attach as attachWindows } from "../src/platforms/windows.ts";

Deno.test("windows platform entry rejects off Windows", async () => {
  const win = new EventTarget() as EventTarget & {
    getSize: () => [number, number];
  };
  win.getSize = () => [1, 1];
  await assertRejects(() => attachWindows(win), NativeUnsupportedError);
});

Deno.test({
  name: "linux platform entry rejects off Linux",
  ignore: Deno.build.os === "linux",
  fn: async () => {
    const win = new EventTarget() as EventTarget & {
      getSize: () => [number, number];
    };
    win.getSize = () => [1, 1];
    await assertRejects(() => attachLinux(win), NativeUnsupportedError);
  },
});

Deno.test("macos platform module exports attach", async () => {
  const mod = await import("../src/platforms/macos.ts");
  assertEquals(typeof mod.attach, "function");
  assertEquals("macKeys" in mod, false);
  assertEquals("loadMacos" in mod, false);
});
