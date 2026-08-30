import { assertEquals } from "@std/assert";
import {
  codeFromMacKeyCode,
  keyFromMac,
  locationFromCode,
} from "../src/keys/macos.ts";
import { linuxKeys } from "../src/keys/linux.ts";
import {
  codeFromWinKeyCode,
  keyFromWin,
  windowsKeys,
} from "../src/keys/windows.ts";

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

Deno.test("windows virtual keys map to UI Events code/key", () => {
  assertEquals(codeFromWinKeyCode(0x41), "KeyA");
  assertEquals(codeFromWinKeyCode(0x0d), "Enter");
  assertEquals(codeFromWinKeyCode(0x1b), "Escape");
  assertEquals(codeFromWinKeyCode(0x25), "ArrowLeft");
  assertEquals(codeFromWinKeyCode(0xa1), "ShiftRight");
  assertEquals(keyFromWin(0x0d, "\r"), "Enter");
  assertEquals(keyFromWin(0x20, " "), " ");
  assertEquals(keyFromWin(0x41, "a"), "a");
  assertEquals(keyFromWin(0x70, ""), "F1");
  assertEquals(locationFromCode(codeFromWinKeyCode(0xa1)), 2);
  assertEquals(locationFromCode(codeFromWinKeyCode(0x67)), 3);
});

Deno.test("windows and linux tables are not the mac table", () => {
  // Mac key code 13 is KeyW; the same number is VK_RETURN on Windows.
  assertEquals(codeFromMacKeyCode(13), "KeyW");
  assertEquals(windowsKeys.codeFromKeyCode(13), "Enter");
  assertEquals(windowsKeys.codeFromKeyCode(0), "");
  assertEquals(linuxKeys.codeFromKeyCode(0), "");
  assertEquals(linuxKeys.keyFromEvent(36, "\r"), "\r");
});
