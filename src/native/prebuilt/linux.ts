import linuxAarch64 from "../../../native/prebuilt/linux-aarch64.so" with {
  type: "bytes",
};

/** Embedded Linux helpers. Vite / esbuild can drop this module on other OSes. */
export function linuxPrebuilt(): Uint8Array {
  if (Deno.build.arch === "aarch64") return linuxAarch64;
  throw new Error(
    `raw-desktop-utils: no prebuilt for linux-${Deno.build.arch}. ` +
      "On that machine run: deno task build:native -- build --target x86_64-unknown-linux-gnu",
  );
}
