#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env
/**
 * Build the Rust cdylib and copy it into native/prebuilt/.
 *
 *   deno task build:native
 *   deno task build:native -- build
 *   deno task build:native -- build --target aarch64-apple-darwin
 *   deno task build:native -- build --target aarch64-unknown-linux-gnu
 *
 * Linux triples on a non-Linux host use Docker (rust:1-bookworm).
 */

import {
  cargoArtifactName,
  prebuiltFileName,
  rustCrateDir,
  rustHostTriple,
} from "../src/native/load.ts";

const TRIPLE_TO_PREBUILT: Record<string, string> = {
  "aarch64-apple-darwin": "darwin-aarch64.dylib",
  "x86_64-apple-darwin": "darwin-x86_64.dylib",
  "x86_64-pc-windows-msvc": "windows-x86_64.dll",
  "x86_64-pc-windows-gnu": "windows-x86_64.dll",
  "aarch64-pc-windows-msvc": "windows-aarch64.dll",
  "x86_64-unknown-linux-gnu": "linux-x86_64.so",
  "aarch64-unknown-linux-gnu": "linux-aarch64.so",
};

const LINUX_DOCKER_PLATFORM: Record<string, string> = {
  "aarch64-unknown-linux-gnu": "linux/arm64",
  "x86_64-unknown-linux-gnu": "linux/amd64",
};

function tripleToPrebuilt(triple: string): string {
  const name = TRIPLE_TO_PREBUILT[triple];
  if (!name) throw new Error(`no prebuilt name for triple ${triple}`);
  return name;
}

function parseTarget(args: string[]): string {
  const idx = args.indexOf("--target");
  if (idx >= 0 && args[idx + 1]) return args[idx + 1]!;
  return rustHostTriple();
}

function wantsDocker(triple: string, args: string[]): boolean {
  if (args.includes("--docker")) return true;
  return triple.includes("linux") && Deno.build.os !== "linux";
}

function printHelp(): void {
  console.log(`Build the Rust cdylib into native/prebuilt/.

Usage:
  deno task build:native -- <command> [options]

Commands:
  build              Build for the host triple (or --target)
  help               Show this help

Options for build:
  --target <triple>  Rust target triple (default: host)
  --docker           Force the Linux Docker path
  -h, --help         Show this help

Examples:
  deno task build:native -- build
  deno task build:native -- build --target aarch64-unknown-linux-gnu

Linux triples on a non-Linux host use Docker (rust:1-bookworm).
Supported triples:
  ${Object.keys(TRIPLE_TO_PREBUILT).join("\n  ")}
`);
}

function repoRoot(): URL {
  return new URL("../", import.meta.url);
}

async function run(cmd: string, args: string[], cwd?: string): Promise<number> {
  const proc = new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await proc.output();
  return code;
}

async function buildWithCargo(triple: string): Promise<URL> {
  const crate = rustCrateDir();
  const code = await run("cargo", [
    "build",
    "--release",
    "--manifest-path",
    new URL("Cargo.toml", crate).pathname,
    "--target",
    triple,
  ], crate.pathname);
  if (code !== 0) Deno.exit(code);
  return new URL(
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
}

async function buildWithDocker(triple: string): Promise<URL> {
  const platform = LINUX_DOCKER_PLATFORM[triple];
  if (!platform) {
    throw new Error(`no Docker platform for ${triple}`);
  }
  const crate = rustCrateDir();
  const destName = tripleToPrebuilt(triple);
  const dest = new URL(`../prebuilt/${destName}`, crate);
  await Deno.mkdir(new URL(".", dest), { recursive: true });
  const imageCode = await run("docker", [
    "build",
    "--platform",
    platform,
    "-t",
    "rde-events-linux",
    "-f",
    new URL("Dockerfile", crate).pathname,
    crate.pathname,
  ]);
  if (imageCode !== 0) Deno.exit(imageCode);
  const code = await run("docker", [
    "run",
    "--rm",
    "--platform",
    platform,
    "-v",
    `${repoRoot().pathname}:/work`,
    "-v",
    "rde-events-cargo-registry:/usr/local/cargo/registry",
    "-v",
    "rde-events-cargo-git:/usr/local/cargo/git",
    "-v",
    "rde-events-linux-target:/target",
    "-e",
    "CARGO_TARGET_DIR=/target",
    "-w",
    "/work/native/rde-events",
    "rde-events-linux",
    "sh",
    "-c",
    `cargo build --release && cp /target/release/librde_events.so /work/native/prebuilt/${destName}`,
  ]);
  if (code !== 0) Deno.exit(code);
  return dest;
}

async function build(args: string[]): Promise<void> {
  if (args.includes("-h") || args.includes("--help")) {
    printHelp();
    return;
  }
  const triple = parseTarget(args);
  const docker = wantsDocker(triple, args);
  const artifact = docker
    ? await buildWithDocker(triple)
    : await buildWithCargo(triple);

  if (!docker) {
    const dest = new URL(
      `../prebuilt/${tripleToPrebuilt(triple)}`,
      rustCrateDir(),
    );
    await Deno.mkdir(new URL(".", dest), { recursive: true });
    await Deno.copyFile(artifact, dest);
    console.log(`wrote ${dest.pathname} (${prebuiltFileName()})`);
  } else {
    console.log(`wrote ${artifact.pathname}`);
  }
}

const args = Deno.args[0] === "--" ? Deno.args.slice(1) : Deno.args;
const command = args[0];
if (
  !command || command === "help" || command === "-h" || command === "--help"
) {
  printHelp();
} else if (command === "build") {
  await build(args.slice(1));
} else {
  console.error(`unknown command: ${command}`);
  printHelp();
  Deno.exit(1);
}
