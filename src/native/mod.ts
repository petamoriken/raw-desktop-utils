import { type NativeBackend, NativeUnsupportedError } from "./backend.ts";

export { type NativeBackend, NativeUnsupportedError } from "./backend.ts";

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
    case "windows": {
      const { loadWindows } = await import("./windows.ts");
      return await loadWindows();
    }
    case "linux": {
      const { loadLinux } = await import("./linux.ts");
      return await loadLinux();
    }
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
