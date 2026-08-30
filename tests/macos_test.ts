import { assertEquals } from "@std/assert";
import { ABI_VERSION } from "../src/native/abi.ts";
import { loadMacos } from "../src/native/macos.ts";

Deno.test({
  name: "macOS prebuilt reports the current ABI and misses unknown titles",
  ignore: Deno.build.os !== "darwin",
  permissions: {
    read: true,
    write: true,
    run: true,
    env: true,
    ffi: true,
  },
  fn: async () => {
    const native = await loadMacos();
    assertEquals(native.abiVersion, ABI_VERSION);
    assertEquals(native.findWindow("__rde_no_such_window__"), null);
    const text = Deno.inspect(native);
    assertEquals(text.includes("MacosBackend"), true);
  },
});
