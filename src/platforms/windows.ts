/**
 * Windows-only entry. The backend is not implemented yet; importing
 * this path keeps macOS / Linux key tables out of a Windows bundle.
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
      "windows",
      "Poll GetCursorPos / GetAsyncKeyState and hook WH_GETMESSAGE; see native/rde-events/src/stub.rs.",
    ),
  );
}
