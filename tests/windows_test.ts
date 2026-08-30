import { assertEquals } from "@std/assert";
import { ABI_VERSION } from "../src/native/abi.ts";
import { loadWindows } from "../src/native/windows.ts";

Deno.test({
  name: "Windows prebuilt reports the current ABI and misses unknown titles",
  ignore: Deno.build.os !== "windows" || Deno.build.arch !== "x86_64",
  permissions: {
    read: true,
    write: true,
    env: true,
    ffi: true,
  },
  fn: async () => {
    const native = await loadWindows();
    assertEquals(native.abiVersion, ABI_VERSION);
    assertEquals(native.findWindow("__rde_no_such_window__"), null);
    const text = Deno.inspect(native);
    assertEquals(text.includes("WindowsBackend"), true);
  },
});

Deno.test({
  name: "Windows snapshot and poll are safe on a null handle",
  ignore: Deno.build.os !== "windows" || Deno.build.arch !== "x86_64",
  permissions: {
    read: true,
    write: true,
    env: true,
    ffi: true,
  },
  fn: async () => {
    const native = await loadWindows();
    assertEquals(native.snapshot(null).valid, false);
    assertEquals(native.pollEvents(null), []);
    assertEquals(native.attach(null), false);
    native.detach(null);
  },
});
