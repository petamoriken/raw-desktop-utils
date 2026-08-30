import { assertEquals } from "@std/assert";
import {
  codeFromMacKeyCode,
  keyFromMac,
  locationFromCode,
} from "../src/keys/macos.ts";
import { linuxKeys } from "../src/keys/linux.ts";
import { windowsKeys } from "../src/keys/windows.ts";

Deno.test("mac key codes map to UI Events code/key", () => {
  assertEquals(codeFromMacKeyCode(0), "KeyA");
  assertEquals(codeFromMacKeyCode(13), "KeyW");
  assertEquals(codeFromMacKeyCode(36), "Enter");
  assertEquals(codeFromMacKeyCode(53), "Escape");
  assertEquals(codeFromMacKeyCode(123), "ArrowLeft");
  assertEquals(keyFromMac(36, "\r"), "Enter");
  assertEquals(keyFromMac(49, " "), " ");
  assertEquals(keyFromMac(0, "a"), "a");
  assertEquals(keyFromMac(122, ""), "F1");
  assertEquals(locationFromCode("ShiftLeft"), 1);
  assertEquals(locationFromCode("MetaRight"), 2);
  assertEquals(locationFromCode("Numpad0"), 3);
  assertEquals(locationFromCode("KeyA"), 0);
});

Deno.test("windows and linux stubs do not use the mac table", () => {
  assertEquals(windowsKeys.codeFromKeyCode(0), "");
  assertEquals(windowsKeys.keyFromEvent(0, "a"), "a");
  assertEquals(linuxKeys.codeFromKeyCode(0), "");
  assertEquals(linuxKeys.keyFromEvent(36, "\r"), "\r");
});
