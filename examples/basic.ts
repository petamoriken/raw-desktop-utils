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

using input = await attach(win, { title: TITLE });

function frame(_time: number) {
  input.poll();
  input.requestAnimationFrame(frame);
}
input.requestAnimationFrame(frame);

input.addEventListener("pointermove", (event) => {
  console.log("move", event.clientX, event.clientY, event.buttons);
});
input.addEventListener("pointerdown", (event) => {
  console.log("down", event.button, event.clientX, event.clientY);
});
input.addEventListener("pointerup", (event) => {
  console.log("up", event.button, event.clientX, event.clientY);
});
input.addEventListener("wheel", (event) => {
  console.log("wheel", event.deltaX, event.deltaY);
});
input.addEventListener("keydown", (event) => {
  console.log("key", event.key, event.code);
});

win.addEventListener("close", () => {
  input.close();
  Deno.exit(0);
});
