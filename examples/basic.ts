/// <reference path="../src/desktop.d.ts" />
/**
 * Attach to a raw `Deno.BrowserWindow` and print Pointer Events.
 *
 *   deno desktop --allow-ffi --allow-read --allow-write --allow-run --allow-env examples/basic.ts
 */
import { attach } from "../mod.ts";

const TITLE = "raw-desktop-events example";

if (!("BrowserWindow" in Deno)) {
  throw new Error("Run with `deno desktop`, not `deno run`.");
}

const win = new Deno.BrowserWindow({
  title: TITLE,
  width: 640,
  height: 480,
});

using input = await attach(win, { title: TITLE, autoPoll: 16 });

input.addEventListener("pointermove", (event) => {
  const e = event as import("../mod.ts").PointerEvent;
  console.log("move", e.clientX, e.clientY, e.buttons);
});
input.addEventListener("pointerdown", (event) => {
  const e = event as import("../mod.ts").PointerEvent;
  console.log("down", e.button, e.clientX, e.clientY);
});
input.addEventListener("pointerup", (event) => {
  const e = event as import("../mod.ts").PointerEvent;
  console.log("up", e.button, e.clientX, e.clientY);
});
input.addEventListener("wheel", (event) => {
  const e = event as import("../mod.ts").WheelEvent;
  console.log("wheel", e.deltaX, e.deltaY);
});
input.addEventListener("keydown", (event) => {
  const e = event as import("../mod.ts").KeyboardEvent;
  console.log("key", e.key, e.code);
});

win.addEventListener("close", () => {
  input.close();
  Deno.exit(0);
});
