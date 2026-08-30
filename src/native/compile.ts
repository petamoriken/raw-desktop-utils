/** Optional cargo rebuild when RDE_COMPILE=1 or no prebuilt is present. */

import {
  cachePath,
  cargoArtifactName,
  checksum,
  rustCrateDir,
  rustHostTriple,
} from "./load.ts";

export async function compileRust(
  triple = rustHostTriple(),
): Promise<string> {
  const crate = rustCrateDir();
  const cargo = new Deno.Command("cargo", {
    args: [
      "build",
      "--release",
      "--manifest-path",
      new URL("Cargo.toml", crate).pathname,
      "--target",
      triple,
    ],
    cwd: crate.pathname,
    stdout: "piped",
    stderr: "piped",
  });
  let output: Deno.CommandOutput;
  try {
    output = await cargo.output();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        "raw-desktop-events: cargo is required to rebuild the native helper. " +
          "Install Rust (https://rustup.rs) or use the committed prebuilt.",
      );
    }
    throw error;
  }
  if (output.code !== 0) {
    throw new Error(
      `raw-desktop-events: cargo build failed (exit ${output.code}): ` +
        new TextDecoder().decode(output.stderr).trim(),
    );
  }
  const artifact = new URL(
    `target/${triple}/release/${cargoArtifactName()}`,
    crate,
  );
  const bytes = await Deno.readFile(artifact);
  const out = cachePath(cargoArtifactName(), checksum(bytes));
  await Deno.writeFile(out, bytes);
  return out;
}
