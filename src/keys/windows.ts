import { keyFromUiCode } from "./shared.ts";
import type { KeyTranslator } from "./types.ts";

export type { KeyTranslator } from "./types.ts";
export { locationFromCode } from "./shared.ts";

/**
 * TODO(windows): Map Win32 virtual-key codes (`VK_*`) and scan codes
 * onto UI Events `KeyboardEvent.code`. Until then, fall back to the
 * UTF-8 character from the native event.
 */
export function codeFromWinKeyCode(_keyCode: number): string {
  return "";
}

export function keyFromWin(keyCode: number, chars: string): string {
  return keyFromUiCode(codeFromWinKeyCode(keyCode), chars);
}

export const windowsKeys: KeyTranslator = {
  codeFromKeyCode: codeFromWinKeyCode,
  keyFromEvent: keyFromWin,
};
