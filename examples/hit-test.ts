/// <reference path="../src/desktop.d.ts" />
/**
 * Two undecorated rectangles. Hover lightens a rect; click turns it white.
 *
 * Hover comes from the pointer snapshot; clicks come from the native queue
 * (local NSEvent monitor plus Combined Session button sampler). Synthesized
 * keys are not captured; this helper does not request Input Monitoring or
 * Accessibility.
 *
 * Do not run this file with bare `deno desktop`: that defaults to the
 * webview backend and attach fails (`native window not found`). On
 * aarch64-apple-darwin the raw backend also has no `.app` template, so
 * package it with `laufey_winit`:
 *
 *   deno task example
 *
 * That writes `hit-test.app` and opens it. JSON lines go to
 * `$RDU_HIT_TEST_LOG` (default `$TMPDIR/rdu-hit-test.log`).
 */
import { attach } from "../mod.ts";
import { fillView, findView } from "./fill.ts";

const TITLE = "rdu hit-test";
const LOG = Deno.env.get("RDU_HIT_TEST_LOG") ??
  `${
    (Deno.env.get("TMPDIR") ?? "/tmp").replace(/[/\\]+$/, "")
  }/rdu-hit-test.log`;

const BG = [0.12, 0.12, 0.12, 1] as const;
const IDLE = [0.28, 0.28, 0.28, 1] as const;
const HOVER = [0.72, 0.72, 0.72, 1] as const;
const DOWN = [1, 1, 1, 1] as const;

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
const view = findView(TITLE);

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

function inView(x: number, y: number): boolean {
  const w = input.innerWidth;
  const h = input.innerHeight;
  return w > 0 && h > 0 && x >= 0 && y >= 0 && x <= w && y <= h;
}

function paint() {
  if (!view) return;
  fillView(
    view,
    BG,
    BUTTONS.map((b) => ({
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      rgba: down === b.id ? DOWN : hover === b.id ? HOVER : IDLE,
    })),
  );
}

let hover: string | null = null;
let down: string | null = null;
paint();

// Raw winit has a host rAF that never ticks unless something presents.
// Drive poll ourselves so hover / click / close stay live.
const pollTimer = setInterval(() => {
  const snap = input.poll();
  const next = inView(snap.clientX, snap.clientY)
    ? hit(snap.clientX, snap.clientY)?.id ?? null
    : null;
  const pressed = (snap.buttons & 1) !== 0 ? (next ?? down) : null;
  const hoverChanged = next !== hover;
  const downChanged = pressed !== down;
  if (hoverChanged) {
    hover = next;
    record("hover", {
      id: hover,
      x: snap.clientX,
      y: snap.clientY,
      inside: snap.inside,
      buttons: snap.buttons,
    });
  }
  if (downChanged) down = pressed;
  if (hoverChanged || downChanged) paint();
}, 16);

input.addEventListener("pointerdown", (event) => {
  const target = hit(event.clientX, event.clientY);
  down = target?.id ?? null;
  record("pointerdown", {
    button: event.button,
    x: event.clientX,
    y: event.clientY,
    id: down,
  });
  paint();
});

input.addEventListener("pointerup", (event) => {
  record("pointerup", {
    button: event.button,
    x: event.clientX,
    y: event.clientY,
    id: down,
  });
  down = null;
  paint();
});

win.addEventListener("close", () => {
  clearInterval(pollTimer);
  input.close();
  Deno.exit(0);
});

record("ready", { title: TITLE, log: LOG });
