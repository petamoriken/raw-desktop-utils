import { keyFromUiCode } from "./shared.ts";
import type { KeyTranslator } from "./types.ts";

export type { KeyTranslator } from "./types.ts";
export { locationFromCode } from "./shared.ts";

/**
 * TODO(linux): Map X11 keysyms / evdev KEY_* codes onto UI Events
 * `KeyboardEvent.code`. Until then, fall back to the UTF-8 character
 * from the native event.
 */
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
