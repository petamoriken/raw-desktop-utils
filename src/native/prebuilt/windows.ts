import windowsX8664 from "../../../native/prebuilt/windows-x86_64.dll" with {
  type: "bytes",
};

export function windowsPrebuilt(): Uint8Array {
  if (Deno.build.arch === "x86_64") return windowsX8664;
  throw new Error(
    `raw-desktop-utils: no prebuilt for windows-${Deno.build.arch}. ` +
      "On that machine run: deno task build:native -- build",
  );
}
