import { assertEquals } from "@std/assert";
import { ABI_VERSION } from "../src/native/abi.ts";
import { loadLinux } from "../src/native/linux.ts";

Deno.test({
  name: "Linux prebuilt reports ABI 1 and misses unknown titles",
  ignore: Deno.build.os !== "linux",
  permissions: {
    read: true,
    write: true,
    env: true,
    ffi: true,
  },
  fn: async () => {
    const native = await loadLinux();
    assertEquals(native.abiVersion, ABI_VERSION);
    assertEquals(native.findWindow("__rde_no_such_window__"), null);
    const text = Deno.inspect(native);
    assertEquals(text.includes("LinuxBackend"), true);
  },
});
