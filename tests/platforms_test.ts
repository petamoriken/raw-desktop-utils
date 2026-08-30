import { assertEquals, assertRejects } from "@std/assert";
import { NativeUnsupportedError } from "../src/native/backend.ts";
import { attach as attachLinux } from "../src/platforms/linux.ts";
import { attach as attachWindows } from "../src/platforms/windows.ts";

Deno.test("windows and linux platform entries reject with NativeUnsupportedError", async () => {
  const win = new EventTarget() as EventTarget & {
    getSize: () => [number, number];
  };
  win.getSize = () => [1, 1];
  await assertRejects(() => attachWindows(win), NativeUnsupportedError);
  await assertRejects(() => attachLinux(win), NativeUnsupportedError);
});

Deno.test("macos platform module exports attach without pulling stubs", async () => {
  const mod = await import("../src/platforms/macos.ts");
  assertEquals(typeof mod.attach, "function");
  assertEquals(typeof mod.loadMacos, "function");
  assertEquals(mod.macKeys.codeFromKeyCode(0), "KeyA");
});
