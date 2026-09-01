import { keyFromUiCode } from "./shared.ts";
import type { KeyTranslator } from "./types.ts";

export type { KeyTranslator } from "./types.ts";
export { locationFromCode } from "./shared.ts";

/** TODO: X11 keysyms / evdev KEY_* → `KeyboardEvent.code`. */
export function codeFromLinuxKeyCode(_keyCode: number): string {
  return "";
}

export function keyFromLinux(keyCode: number, chars: string): string {
  return keyFromUiCode(codeFromLinuxKeyCode(keyCode), chars);
}

export const linuxKeys: KeyTranslator = {
  codeFromKeyCode: codeFromLinuxKeyCode,
  keyFromEvent: keyFromLinux,
};
