import { NativeUnsupportedError, type NativeBackend } from "./backend.ts";

export { NativeUnsupportedError, type NativeBackend } from "./backend.ts";

let cached: Promise<NativeBackend> | undefined;

export function loadNative(): Promise<NativeBackend> {
  cached ??= openBackend();
  return cached;
}

async function openBackend(): Promise<NativeBackend> {
  switch (Deno.build.os) {
    case "darwin": {
      const { loadMacos } = await import("./macos.ts");
      return await loadMacos();
    }
    case "windows":
      throw new NativeUnsupportedError(
        "windows",
        "Poll GetCursorPos / GetAsyncKeyState and hook WH_GETMESSAGE; see native/windows/events.c.",
      );
    case "linux":
      throw new NativeUnsupportedError(
        "linux",
        "Poll XQueryPointer (and later wl_pointer); see native/linux/events.c.",
      );
    default:
      throw new NativeUnsupportedError(Deno.build.os);
  }
}

export async function findWindow(title: string): Promise<Deno.PointerValue> {
  return (await loadNative()).findWindow(title);
}

export async function findFrontWindow(): Promise<Deno.PointerValue> {
  return (await loadNative()).findFrontWindow();
}
