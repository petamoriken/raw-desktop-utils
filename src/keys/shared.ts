/** UI Events `KeyboardEvent.code` → `key` for non-character keys. */
const CODE_TO_KEY: Record<string, string> = {
  Enter: "Enter",
  NumpadEnter: "Enter",
  Tab: "Tab",
  Space: " ",
  Backspace: "Backspace",
  Escape: "Escape",
  MetaLeft: "Meta",
  MetaRight: "Meta",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  AltLeft: "Alt",
  AltRight: "Alt",
  ControlLeft: "Control",
  ControlRight: "Control",
  CapsLock: "CapsLock",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  ArrowDown: "ArrowDown",
  ArrowUp: "ArrowUp",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Delete: "Delete",
  Help: "Help",
  Fn: "Fn",
  NumLock: "NumLock",
};

export function locationFromCode(code: string): number {
  if (code.endsWith("Left")) return 1;
  if (code.endsWith("Right")) return 2;
  if (code.startsWith("Numpad")) return 3;
  return 0;
}

export function keyFromUiCode(code: string, chars: string): string {
  if (code && CODE_TO_KEY[code]) return CODE_TO_KEY[code];
  if (/^F\d+$/.test(code)) return code;
  if (chars.length > 0) return chars;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!.toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1]!;
  return code || "Unidentified";
}
