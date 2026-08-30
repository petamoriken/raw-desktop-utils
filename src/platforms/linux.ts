/**
 * Linux-only entry. Import this from Vite / esbuild when the bundle
 * should not contain macOS or Windows backends:
 *
 *   import { attach } from "raw-desktop-events/linux";
 */
import { loadLinux } from "../native/linux.ts";
import { NativeUnsupportedError } from "../native/backend.ts";
import { attachWith, type InputSession } from "../session.ts";
import type { AttachOptions, DesktopWindow } from "../types.ts";

export async function attach(
  win: DesktopWindow,
  options: AttachOptions = {},
): Promise<InputSession> {
  if (Deno.build.os !== "linux") {
    throw new NativeUnsupportedError(
      "linux",
      "The X11 helper must be loaded on Linux.",
    );
  }
  return attachWith(await loadLinux(), win, options);
}
