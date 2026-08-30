#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env --allow-ffi
/**
 * Compile `examples/hit-test.ts` as a raw desktop app and wrap it as
 * `hit-test.app` around `laufey_winit`.
 *
 * `deno desktop --backend raw` does not ship a raw `.app` template on
 * aarch64-apple-darwin, so the compile step is expected to fail at wrap
 * time after writing the runtime dylib.
 */
const root = new URL("../", import.meta.url);
const appUrl = new URL("hit-test.app", root);
const fillSrc = new URL("examples/fill.m", root);
const fillDylib = new URL("examples/libfill.dylib", root);

function pathOf(url: URL): string {
  return url.pathname;
}

async function run(
  name: string,
  args: string[],
  cwd?: string,
): Promise<number> {
  const cmd = new Deno.Command(name, {
    args,
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();
  return code;
}

function findLaufeyWinit(): string {
  const cache = `${Deno.env.get("HOME")}/Library/Caches/deno/laufey`;
  const matches: string[] = [];
  const walk = (dir: string) => {
    for (const e of Deno.readDirSync(dir)) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) walk(p);
      else if (e.name === "laufey_winit") matches.push(p);
    }
  };
  try {
    walk(cache);
  } catch {
    throw new Error(
      "laufey cache missing; run `deno desktop --backend raw` once to download it",
    );
  }
  matches.sort();
  const bin = matches.at(-1);
  if (!bin) {
    throw new Error(
      "laufey_winit not found under ~/Library/Caches/deno/laufey",
    );
  }
  return bin;
}

function findCompiledDylib(): string | null {
  for (const name of ["hit-test.dylib", "hit-test.app.dylib"]) {
    const p = `${pathOf(root)}${name}`;
    try {
      Deno.statSync(p);
      return p;
    } catch {
      // try next
    }
  }
  return null;
}

function writeInfoPlist(dest: string) {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>rdu hit-test</string>
  <key>CFBundleExecutable</key><string>hit-test</string>
  <key>CFBundleIdentifier</key><string>dev.moriken.rdu-hit-test</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>rdu hit-test</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
  Deno.writeTextFileSync(dest, plist);
}

async function assembleApp(runtimeDylib: string) {
  const app = pathOf(appUrl);
  const macos = `${app}/Contents/MacOS`;
  await Deno.remove(app, { recursive: true }).catch(() => {});
  await Deno.mkdir(macos, { recursive: true });
  writeInfoPlist(`${app}/Contents/Info.plist`);
  Deno.writeTextFileSync(`${app}/Contents/PkgInfo`, "APPL????");

  const laufey = findLaufeyWinit();
  await Deno.copyFile(laufey, `${macos}/laufey_winit`);
  await Deno.chmod(`${macos}/laufey_winit`, 0o755);
  await Deno.copyFile(runtimeDylib, `${macos}/hit-test.dylib`);
  await Deno.chmod(`${macos}/hit-test.dylib`, 0o755);

  const launcher = `#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
export LAUFEY_RUNTIME_PATH="$DIR/hit-test.dylib"
exec "$DIR/laufey_winit" --runtime "$DIR/hit-test.dylib" "$@"
`;
  Deno.writeTextFileSync(`${macos}/hit-test`, launcher);
  await Deno.chmod(`${macos}/hit-test`, 0o755);

  const sign = await run("codesign", ["--force", "--deep", "--sign", "-", app]);
  if (sign !== 0) throw new Error("codesign failed");
  console.log(`wrote ${app}`);
}

async function compileFill() {
  const src = pathOf(fillSrc);
  const out = pathOf(fillDylib);
  try {
    const built = Deno.statSync(out);
    const m = Deno.statSync(src);
    if (built.mtime && m.mtime && built.mtime >= m.mtime) return;
  } catch {
    // rebuild
  }
  const code = await run("cc", [
    "-dynamiclib",
    "-o",
    out,
    src,
    "-framework",
    "AppKit",
    "-framework",
    "QuartzCore",
  ]);
  if (code !== 0) throw new Error("cc examples/fill.m failed");
}

async function compileRuntime(): Promise<string> {
  const code = await run(Deno.execPath(), [
    "desktop",
    "--backend",
    "raw",
    "--allow-read",
    "--allow-write",
    "--allow-ffi",
    "--allow-env",
    "--output",
    pathOf(new URL("hit-test", root)),
    "examples/hit-test.ts",
  ], pathOf(root));
  const dylib = findCompiledDylib();
  if (!dylib) {
    throw new Error(
      `deno desktop exited ${code} and did not produce hit-test.dylib`,
    );
  }
  if (code !== 0) {
    console.log(
      "deno desktop could not wrap the raw backend as an .app; assembling hit-test.app around laufey_winit",
    );
  }
  return dylib;
}

await compileFill();
const runtime = await compileRuntime();
await assembleApp(runtime);

if (!Deno.args.includes("--no-open")) {
  const code = await run("open", [pathOf(appUrl)]);
  if (code !== 0) throw new Error("open hit-test.app failed");
}
