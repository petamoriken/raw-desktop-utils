/** Compile a native helper into TMPDIR, keyed by a source checksum. */

export type CompileSpec = {
  source: URL;
  outputName: string;
  args: (outPath: string, srcPath: string) => string[];
};

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
  return `${dir}/${outputName}-${digest}`;
}

export async function compileNative(spec: CompileSpec): Promise<string> {
  const srcPath = spec.source.pathname;
  const bytes = await Deno.readFile(spec.source);
  const out = cachePath(spec.outputName, checksum(bytes));
  try {
    const stat = await Deno.stat(out);
    if (stat.isFile && stat.size > 0) return out;
  } catch {
    // rebuild
  }
  const argv = spec.args(out, srcPath);
  const cmd = new Deno.Command(argv[0]!, {
    args: argv.slice(1),
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    const msg = new TextDecoder().decode(stderr).trim();
    throw new Error(
      `raw-desktop-events: failed to compile ${srcPath} (exit ${code}): ${msg}`,
    );
  }
  return out;
}

export function macosSpec(): CompileSpec {
  const source = new URL("../../native/macos/events.m", import.meta.url);
  return {
    source,
    outputName: "librde_events.dylib",
    args: (out, src) => [
      "clang",
      "-dynamiclib",
      "-fobjc-arc",
      "-framework",
      "Cocoa",
      "-o",
      out,
      src,
    ],
  };
}

export function windowsSpec(): CompileSpec {
  const source = new URL("../../native/windows/events.c", import.meta.url);
  return {
    source,
    outputName: "rde_events.dll",
    args: (out, src) => ["clang", "-shared", "-o", out, src, "-luser32"],
  };
}

export function linuxSpec(): CompileSpec {
  const source = new URL("../../native/linux/events.c", import.meta.url);
  return {
    source,
    outputName: "librde_events.so",
    args: (out, src) => ["cc", "-shared", "-fPIC", "-o", out, src],
  };
}
