/** Native key code + UTF-8 → UI Events `key` / `code`. */
export type KeyTranslator = {
  codeFromKeyCode(keyCode: number): string;
  keyFromEvent(keyCode: number, chars: string): string;
};
