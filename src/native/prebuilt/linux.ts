import linuxAarch64 from "../../../native/prebuilt/linux-aarch64.so" with {
  type: "bytes",
};
import linuxX8664 from "../../../native/prebuilt/linux-x86_64.so" with {
  type: "bytes",
};

export function linuxPrebuilt(): Uint8Array {
  if (Deno.build.arch === "aarch64") return linuxAarch64;
  if (Deno.build.arch === "x86_64") return linuxX8664;
  throw new Error(
    `raw-desktop-utils: no prebuilt for linux-${Deno.build.arch}. ` +
      "On that machine run: deno task build:native -- build",
  );
}
