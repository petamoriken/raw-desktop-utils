/**
 * Load the AppKit rectangle filler compiled from `fill.m`.
 * `deno task example` builds `libfill.dylib` before packaging.
 */
import fillBytes from "./libfill.dylib" with { type: "bytes" };

type FillLib = {
  symbols: {
    rdu_ex_find_view: (title: BufferSource) => Deno.PointerValue;
    rdu_ex_fill: (
      view: Deno.PointerValue,
      bg: Deno.PointerValue,
      xywh: Deno.PointerValue,
      rgba: Deno.PointerValue,
      n: number,
    ) => void;
  };
};

let lib: FillLib | null = null;

function checksum(bytes: Uint8Array): string {
  let sum = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    sum ^= bytes[i]!;
    sum = Math.imul(sum, 16777619);
  }
  return (sum >>> 0).toString(16);
}

function loadFill(): FillLib {
  if (lib) return lib;
  const dir = (Deno.env.get("TMPDIR") ?? "/tmp").replace(/[/\\]+$/, "");
  const path = `${dir}/libfill-${fillBytes.byteLength}-${
    checksum(fillBytes)
  }.dylib`;
  try {
    const stat = Deno.statSync(path);
    if (!stat.isFile || stat.size !== fillBytes.byteLength) {
      Deno.writeFileSync(path, fillBytes);
    }
  } catch {
    Deno.writeFileSync(path, fillBytes);
  }
  lib = Deno.dlopen(path, {
    rdu_ex_find_view: { parameters: ["buffer"], result: "pointer" },
    rdu_ex_fill: {
      parameters: ["pointer", "pointer", "pointer", "pointer", "i32"],
      result: "void",
    },
  });
  return lib;
}

export function findView(title: string): Deno.PointerValue {
  return loadFill().symbols.rdu_ex_find_view(
    new TextEncoder().encode(`${title}\0`),
  );
}

export type Rgba = readonly [number, number, number, number];

export type FillRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  rgba: Rgba;
};

export function fillView(
  view: Deno.PointerValue,
  bg: Rgba,
  rects: readonly FillRect[],
) {
  const bgBuf = new Float32Array(bg);
  const xywh = new Float32Array(rects.length * 4);
  const rgba = new Float32Array(rects.length * 4);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    xywh.set([r.x, r.y, r.w, r.h], i * 4);
    rgba.set(r.rgba, i * 4);
  }
  loadFill().symbols.rdu_ex_fill(
    view,
    Deno.UnsafePointer.of(bgBuf),
    Deno.UnsafePointer.of(xywh),
    Deno.UnsafePointer.of(rgba),
    rects.length,
  );
}
