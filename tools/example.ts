#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env --allow-ffi
/** Run `examples/hit-test.ts`. Wraps `laufey_winit` as `.app` on aarch64-apple-darwin. */
const root = new URL("../", import.meta.url);
const appUrl = new URL("hit-test.app", root);
const DESKTOP_ALLOW = [
  "--allow-read",
  "--allow-write",
  "--allow-ffi",
  "--allow-env",
] as const;

function pathOf(url: URL): string {
  if (url.protocol !== "file:") throw new Error(url.href);
  let path = decodeURIComponent(url.pathname);
  if (Deno.build.os === "windows" && /^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1);
  }
  return path;
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

async function compileRuntime(): Promise<string> {
  const code = await run(Deno.execPath(), [
    "desktop",
    ...DESKTOP_ALLOW,
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

async function runDesktop() {
  const code = await run(Deno.execPath(), [
    "desktop",
    ...DESKTOP_ALLOW,
    "examples/hit-test.ts",
  ], pathOf(root));
  if (code !== 0) throw new Error(`deno desktop exited ${code}`);
}

const needsAppBundle = Deno.build.os === "darwin" &&
  Deno.build.arch === "aarch64";

if (needsAppBundle) {
  const runtime = await compileRuntime();
  await assembleApp(runtime);
  if (!Deno.args.includes("--no-open")) {
    const code = await run("open", [pathOf(appUrl)]);
    if (code !== 0) throw new Error("open hit-test.app failed");
  }
} else {
  await runDesktop();
}
