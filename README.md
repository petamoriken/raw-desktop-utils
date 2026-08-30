# raw-desktop-events

UI Events and Pointer Events for [`deno desktop`](https://docs.deno.com/runtime/desktop/) **raw** mode.

A raw `Deno.BrowserWindow` has no DOM, so `PointerEvent`, `MouseEvent.offsetX`,
and the rest of the UI Events model are missing or unusable. This library
reads the OS pointer (and queued click / wheel / key events) through FFI and
synthesizes the same event shapes a browser would dispatch.

macOS is implemented. Windows and Linux export the same native ABI but are
not implemented yet — see `native/windows/events.c` and `native/linux/events.c`.

## Install

Intended for [JSR](https://jsr.io). Until it is published, import from the
repo path:

```ts
import { attach, type PointerEvent } from "../raw-desktop-events/mod.ts";
```

Permissions: `--allow-ffi --allow-read --allow-write --allow-run --allow-env`.
The first call compiles a small platform helper (`clang` on macOS) into
`TMPDIR` and caches it by source checksum.

## Usage

```ts
const win = new Deno.BrowserWindow({ title: "Game", width: 1280, height: 720 });
using input = await attach(win, { title: "Game" });

input.addEventListener("pointermove", (event) => {
  const e = event as PointerEvent;
  game.hover(e.clientX, e.clientY);
});
input.addEventListener("pointerdown", (event) => {
  const e = event as PointerEvent;
  if (e.button === 0) game.click(e.clientX, e.clientY);
});

// Inside the render loop:
input.poll();
```

Listen on the **session**, not on `BrowserWindow`. The window may still emit
incomplete mouse events; mixing the two sources can double-fire clicks.

`attach` options:

| Option | Meaning |
| --- | --- |
| `title` | Locate the native content view by window title (required on macOS unless you pass `native`). |
| `native` | Existing `NSView*` / `HWND` / etc. |
| `target` | Extra `EventTarget` that also receives copies of each event. |
| `mouseEvents` | Also fire `mousedown` / `click` / `contextmenu` (default `true`). |
| `autoPoll` | Interval in ms; omit to poll yourself. |
| `locateTimeoutMs` | How long to wait for the window to appear (default 500). |

Coordinates use a **top-left** origin in logical (point) pixels of the content
view. That matches CSS `clientX` / `clientY`. On macOS the helper stays in
screen space and flips Y; it does not call `convertPoint` / `isFlipped` on
winit views, which invert hit tests.

## Events

From a live snapshot plus the native queue:

- `pointerover` / `pointerenter` / `pointermove` / `pointerdown` / `pointerup` / `pointerout` / `pointerleave`
- compatibility `mouse*` , `click`, `dblclick`, `auxclick`, `contextmenu`
- `wheel`
- `keydown` / `keyup`

Classes implement `Symbol.for("Deno.customInspect")`, so `console.log(event)`
prints the public fields instead of empty private state.

## Native ABI

All platforms expose the same C symbols (`rde_find_window`, `rde_snapshot`,
`rde_poll_events`, …). Rebuild the current platform helper with:

```sh
deno task build:native
```

## License

MIT
