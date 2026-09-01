export function checksum(bytes: Uint8Array): string {
  let sum = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    sum ^= bytes[i]!;
    sum = Math.imul(sum, 16777619);
  }
  return (sum >>> 0).toString(16).padStart(8, "0");
}

export function cachePath(outputName: string, digest: string): string {
  const dir = (Deno.env.get("TMPDIR") ?? Deno.env.get("TEMP") ?? "/tmp")
    .replace(/[/\\]$/, "");
  const sep = Deno.build.os === "windows" ? "\\" : "/";
  return `${dir}${sep}${outputName}-${digest}`;
}

/** `file:` URL → native path (`URL.pathname` is not usable on Windows). */
export function fileUrlToPath(url: URL): string {
  const decoded = decodeURIComponent(url.pathname);
  if (Deno.build.os !== "windows") return decoded;
  return decoded.replace(/^\/(?=[A-Za-z]:)/, "").replace(/\//g, "\\");
}

export async function materializeLibrary(
  bytes: Uint8Array,
  outputName: string,
): Promise<string> {
  const out = cachePath(outputName, checksum(bytes));
  try {
    const stat = await Deno.stat(out);
    if (stat.isFile && stat.size === bytes.byteLength) return out;
  } catch {
    // missing
  }
  await Deno.writeFile(out, bytes);
  return out;
}

export function rustCrateDir(): URL {
  return new URL("../../native/rdu/", import.meta.url);
}

export function rustHostTriple(): string {
  const arch = Deno.build.arch === "x86_64" ? "x86_64" : Deno.build.arch;
  switch (Deno.build.os) {
    case "darwin":
      return `${arch}-apple-darwin`;
    case "windows":
      return `${arch}-pc-windows-msvc`;
    case "linux":
      return `${arch}-unknown-linux-gnu`;
    default:
      throw new Error(
        `raw-desktop-utils: no Rust triple for ${Deno.build.os}-${Deno.build.arch}`,
      );
  }
}

export function prebuiltFileName(
  os = Deno.build.os,
  arch = Deno.build.arch,
): string {
  if (os === "darwin") return `darwin-${arch}.dylib`;
  if (os === "windows") return `windows-${arch}.dll`;
  return `linux-${arch}.so`;
}

export function cargoArtifactName(os = Deno.build.os): string {
  if (os === "windows") return "rdu.dll";
  if (os === "darwin") return "librdu.dylib";
  return "librdu.so";
}
