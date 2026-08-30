import darwinAarch64 from "../../../native/prebuilt/darwin-aarch64.dylib" with {
  type: "bytes",
};

/** Embedded macOS helpers. Vite / esbuild can drop this module on other OSes. */
export function darwinPrebuilt(): Uint8Array {
  if (Deno.build.arch === "aarch64") return darwinAarch64;
  throw new Error(
    `raw-desktop-events: no prebuilt for darwin-${Deno.build.arch}. ` +
      "On that Mac run: deno task build:native",
  );
}
