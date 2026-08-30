#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env
/** Compile the native helper for the current OS into TMPDIR (and log the path). */

import {
  compileNative,
  linuxSpec,
  macosSpec,
  windowsSpec,
} from "../src/native/compile.ts";

const spec = {
  darwin: macosSpec,
  windows: windowsSpec,
  linux: linuxSpec,
}[Deno.build.os];

if (!spec) {
  throw new Error(`no native build spec for ${Deno.build.os}`);
}

const path = await compileNative(spec());
console.log(path);
