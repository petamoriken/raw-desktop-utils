/**
 * Windows-only entry. Import this from Vite / esbuild when the bundle
 * should not contain macOS or Linux backends or key tables:
 *
 *   import { attach } from "@petamoriken/raw-desktop-utils/windows";
 */
import { NativeUnsupportedError } from "../native/backend.ts";
import { loadWindows } from "../native/windows.ts";
import { attachWith, type InputSession } from "../session.ts";
import type { AttachOptions, DesktopWindow } from "../types.ts";

export async function attach(
  win: DesktopWindow,
  options: AttachOptions = {},
): Promise<InputSession> {
  if (Deno.build.os !== "windows") {
    throw new NativeUnsupportedError(
      "windows",
      "The Win32 helper must be loaded on Windows.",
    );
  }
  return attachWith(await loadWindows(), win, options);
}
