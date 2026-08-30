#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env
/**
 * Build the Rust cdylib and copy it into native/prebuilt/.
 *
 *   deno task build:native
 *   deno task build:native -- --target aarch64-apple-darwin
 */

import {
  cargoArtifactName,
  prebuiltFileName,
  rustCrateDir,
  rustHostTriple,
} from "../src/native/load.ts";

function tripleToPrebuilt(triple: string): string {
  const map: Record<string, string> = {
    "aarch64-apple-darwin": "darwin-aarch64.dylib",
    "x86_64-apple-darwin": "darwin-x86_64.dylib",
    "x86_64-pc-windows-msvc": "windows-x86_64.dll",
    "x86_64-pc-windows-gnu": "windows-x86_64.dll",
    "aarch64-pc-windows-msvc": "windows-aarch64.dll",
    "x86_64-unknown-linux-gnu": "linux-x86_64.so",
    "aarch64-unknown-linux-gnu": "linux-aarch64.so",
  };
  const name = map[triple];
  if (!name) throw new Error(`no prebuilt name for triple ${triple}`);
  return name;
}

function parseTarget(): string {
  const idx = Deno.args.indexOf("--target");
  if (idx >= 0 && Deno.args[idx + 1]) return Deno.args[idx + 1]!;
  return rustHostTriple();
}

const triple = parseTarget();
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
  stdout: "inherit",
  stderr: "inherit",
});
const { code } = await cargo.output();
if (code !== 0) Deno.exit(code);

const artifact = new URL(
  `target/${triple}/release/${
    cargoArtifactName(
      triple.includes("windows")
        ? "windows"
        : triple.includes("apple")
        ? "darwin"
        : "linux",
    )
  }`,
  crate,
);
const dest = new URL(
  `../prebuilt/${tripleToPrebuilt(triple)}`,
  crate,
);
await Deno.mkdir(new URL(".", dest), { recursive: true });
await Deno.copyFile(artifact, dest);
console.log(`wrote ${dest.pathname} (${prebuiltFileName()})`);
