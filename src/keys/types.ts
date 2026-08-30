/** Maps a native key code + UTF-8 chars onto UI Events `key` / `code`. */
export type KeyTranslator = {
  codeFromKeyCode(keyCode: number): string;
  keyFromEvent(keyCode: number, chars: string): string;
};
