/** macOS-only entry. Bundlers that import this drop the other OS backends. */
import { loadMacos } from "../native/macos.ts";
import { attachWith, type InputSession } from "../session.ts";
import type { AttachOptions, DesktopWindow } from "../types.ts";

export async function attach(
  win: DesktopWindow,
  options: AttachOptions = {},
): Promise<InputSession> {
  return attachWith(await loadMacos(), win, options);
}
