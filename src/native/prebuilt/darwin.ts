import darwinAarch64 from "../../../native/prebuilt/darwin-aarch64.dylib" with {
  type: "bytes",
};

export function darwinPrebuilt(): Uint8Array {
  if (Deno.build.arch === "aarch64") return darwinAarch64;
  throw new Error(
    `raw-desktop-utils: no prebuilt for darwin-${Deno.build.arch}. ` +
      "On that Mac run: deno task build:native -- build",
  );
}
