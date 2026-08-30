/**
 * Linux-only entry. The backend is not implemented yet; importing
 * this path keeps macOS / Windows key tables out of a Linux bundle.
 */
import { NativeUnsupportedError } from "../native/backend.ts";
import type { InputSession } from "../session.ts";
import type { AttachOptions, DesktopWindow } from "../types.ts";

export function attach(
  _win: DesktopWindow,
  _options?: AttachOptions,
): Promise<InputSession> {
  return Promise.reject(
    new NativeUnsupportedError(
      "linux",
      "Poll XQueryPointer (and later wl_pointer); see native/rde-events/src/stub.rs.",
    ),
  );
}
