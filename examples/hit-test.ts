/// <reference path="../src/desktop.d.ts" />
/**
 * Two logical rectangles. Hover and click are logged; there is no native
 * blit because raw has none that is portable.
 *
 * Hover comes from the pointer snapshot; clicks come from the native queue.
 * Synthesized keys are not captured; this helper does not request Input
 * Monitoring or Accessibility.
 *
 * Close chrome is left to `deno desktop`. Listen for `BrowserWindow`
 * `"close"` (and `isClosed()`): a live timer keeps the process up after the
 * window is gone, so the handler must `Deno.exit`. Do not run this file
 * with bare `deno desktop` on aarch64-apple-darwin (no raw `.app` template);
 * package it with `laufey_winit`:
 *
 *   deno task example
 *
 * Elsewhere `deno task example` just runs `deno desktop` against this file.
 * JSON lines go to `$RDU_HIT_TEST_LOG` (default `$TMPDIR/rdu-hit-test.log`).
 */
import { attach } from "../mod.ts";

const TITLE = "rdu hit-test";
const LOG = Deno.env.get("RDU_HIT_TEST_LOG") ??
  `${
    (Deno.env.get("TMPDIR") ?? Deno.env.get("TMP") ?? "/tmp").replace(
      /[/\\]+$/,
      "",
    )
  }/rdu-hit-test.log`;

const BUTTONS = [
  { id: "a", x: 40, y: 120, w: 240, h: 80 },
  { id: "b", x: 40, y: 220, w: 240, h: 80 },
] as const;

if (!("BrowserWindow" in Deno)) {
  throw new Error("Run with `deno task example`, not `deno run`.");
}

const win = new Deno.BrowserWindow({
  title: TITLE,
  width: 640,
  height: 400,
});

const input = await attach(win, { title: TITLE, locateTimeoutMs: 2000 });

await Deno.writeTextFile(LOG, "");

function hit(x: number, y: number): (typeof BUTTONS)[number] | null {
  return BUTTONS.find((b) =>
    x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
  ) ?? null;
}

function record(kind: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: Date.now(), kind, ...extra });
  console.log(line);
  Deno.writeTextFileSync(LOG, `${line}\n`, { append: true });
}

function inContent(x: number, y: number): boolean {
  const w = input.innerWidth;
  const h = input.innerHeight;
  return w > 0 && h > 0 && x >= 0 && y >= 0 && x <= w && y <= h;
}

function windowIsClosed(): boolean {
  return typeof win.isClosed === "function" && win.isClosed();
}

let hover: string | null = null;
let down: string | null = null;
let quitting = false;

function quit() {
  if (quitting) return;
  quitting = true;
  record("quit", {});
  clearInterval(pollTimer);
  input.close();
  try {
    win.close();
  } catch {
    // already gone
  }
  Deno.exit(0);
}

// Raw winit has a host rAF that never ticks unless something presents.
// Drive poll ourselves so hover / click stay live. Chrome clicks are not
// handled here: `BrowserWindow` "close" / `isClosed()` own that.
const pollTimer = setInterval(() => {
  if (windowIsClosed()) {
    quit();
    return;
  }
  const snap = input.poll();
  const next = inContent(snap.clientX, snap.clientY)
    ? hit(snap.clientX, snap.clientY)?.id ?? null
    : null;
  const pressed = (snap.buttons & 1) !== 0 ? (next ?? down) : null;
  if (next !== hover) {
    hover = next;
    record("hover", {
      id: hover,
      x: snap.clientX,
      y: snap.clientY,
      inside: snap.inside,
      buttons: snap.buttons,
    });
  }
  if (pressed !== down) down = pressed;
}, 16);

input.addEventListener("pointerdown", (event) => {
  if (!inContent(event.clientX, event.clientY)) return;
  const target = hit(event.clientX, event.clientY);
  down = target?.id ?? null;
  record("pointerdown", {
    button: event.button,
    x: event.clientX,
    y: event.clientY,
    id: down,
  });
});

input.addEventListener("pointerup", (event) => {
  if (!inContent(event.clientX, event.clientY) && down === null) return;
  record("pointerup", {
    button: event.button,
    x: event.clientX,
    y: event.clientY,
    id: down,
  });
  down = null;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    quit();
    return;
  }
  record("keydown", {
    key: event.key,
    code: event.code,
    location: event.location,
    repeat: event.repeat,
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
  });
});

input.addEventListener("keyup", (event) => {
  record("keyup", {
    key: event.key,
    code: event.code,
    location: event.location,
  });
});

win.addEventListener("close", quit);

record("ready", { title: TITLE, log: LOG });
