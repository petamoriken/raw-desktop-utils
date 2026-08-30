/**
 * macOS-only entry. Import this from Vite / esbuild when the bundle
 * should not contain Windows or Linux backends or key tables:
 *
 *   import { attach } from "raw-desktop-events/macos";
 */
import { loadMacos } from "../native/macos.ts";
import { attachWith, type InputSession } from "../session.ts";
import type { AttachOptions, DesktopWindow } from "../types.ts";

export async function attach(
  win: DesktopWindow,
  options: AttachOptions = {},
): Promise<InputSession> {
  return attachWith(await loadMacos(), win, options);
}
