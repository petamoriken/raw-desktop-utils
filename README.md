# raw-desktop-utils

Utilities for [`deno desktop`](https://docs.deno.com/runtime/desktop/) raw
`BrowserWindow`s: attach an input session, poll OS pointer and key events as DOM
events, and drive the loop with `requestAnimationFrame`.

`attach(window)` returns an `InputSession`. Each `poll()` reads the OS pointer
and the queued click / wheel / key events through FFI, then dispatches the same
`PointerEvent` / `MouseEvent` / `WheelEvent` / `KeyboardEvent` shapes a browser
would. Listen on the **session**, not on `BrowserWindow` (the window can still
emit incomplete mouse events and double-fire).

Drive the loop with `input.requestAnimationFrame` — the runtime's rAF when it
exists, otherwise a 60 Hz polyfill. Closing the session cancels pending frames.

macOS (AppKit) and Linux (X11, or Wayland when `WAYLAND_DISPLAY` is set) are
implemented. Windows still uses the stub in `native/rde-events/src/stub.rs`.
Linux `.so` files are built with Docker when the host is not Linux
(`deno task build:native -- build --target aarch64-unknown-linux-gnu`).

## Install

```ts
import { attach } from "jsr:@petamoriken/raw-desktop-utils";
```

Vite / esbuild should import a platform subpath so unused OS backends and key
tables are dropped from the bundle:

```ts
import { attach } from "jsr:@petamoriken/raw-desktop-utils/macos";
```

Permissions: `--allow-ffi --allow-read --allow-write --allow-env`. The package
loads a committed prebuilt (`native/prebuilt/`) so a `deno desktop` /
`deno compile` host does not need `cargo`. Refresh the prebuilt in this repo
with `deno task build:native -- build`.

## Usage

```ts
const win = new Deno.BrowserWindow({ title: "Game", width: 1280, height: 720 });
using input = await attach(win, { title: "Game" });

input.addEventListener("pointermove", (event) => {
  game.hover(event.clientX, event.clientY);
});
input.addEventListener("pointerdown", (event) => {
  if (event.button === 0) game.click(event.clientX, event.clientY);
});

function frame(_time: number) {
  input.poll();
  game.draw();
  input.requestAnimationFrame(frame);
}
input.requestAnimationFrame(frame);
```

`addEventListener` is typed like the DOM: `"pointermove"` gives a
`PointerEvent`, `"wheel"` a `WheelEvent`, `"keydown"` a `KeyboardEvent`.
`input.requestAnimationFrame` / `input.cancelAnimationFrame` match the HTML
`Window` methods.

`attach` options:

| Option            | Meaning                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `title`           | Locate the native content view by window title (required on macOS unless you pass `native`). Title search is X11-only on Linux. |
| `native`          | Existing `NSView*` / `HWND` / X11 window / `wl_surface*`.                                                                       |
| `display`         | Wayland `wl_display*` (`getNativeWindow().displayHandle`). Optional if the surface can yield it.                                |
| `target`          | Extra `EventTarget` that also receives copies of each event.                                                                    |
| `mouseEvents`     | Also fire `mousedown` / `click` / `contextmenu` (default `true`).                                                               |
| `autoPoll`        | Interval in ms; omit to poll yourself.                                                                                          |
| `locateTimeoutMs` | How long to wait for the window to appear (default 500).                                                                        |

Coordinates use a **top-left** origin in logical (point) pixels of the content
view. That matches CSS `clientX` / `clientY`. On macOS the helper stays in
screen space and flips Y; it does not call `convertPoint` / `isFlipped` on winit
views, which invert hit tests.

## Events

From a live snapshot plus the native queue:

- `pointerover` / `pointerenter` / `pointermove` / `pointerdown` / `pointerup` /
  `pointerout` / `pointerleave`
- compatibility `mouse*` , `click`, `dblclick`, `auxclick`, `contextmenu`
- `wheel`
- `keydown` / `keyup`

The public exports are `attach`, `InputSession`, and the DOM constructors
(`PointerEvent`, `MouseEvent`, `WheelEvent`, `KeyboardEvent`, `UIEvent`).
Platform key tables and inspect internals stay private.

## Native ABI

The helper is a Rust `cdylib` (`native/rde-events`). macOS is AppKit. Linux is
X11 or Wayland (same `WAYLAND_DISPLAY` rule as laufey_winit). Windows still
exports the same C symbols as a stub.

```sh
deno task build:native -- build
deno task build:native -- build --target aarch64-apple-darwin
deno task build:native -- build --target aarch64-unknown-linux-gnu
# or, for x86_64 Linux from a Mac:
deno task build:native -- build --target x86_64-unknown-linux-gnu
```

That writes `native/prebuilt/<os>-<arch>.{dylib,dll,so}`. Runtime code embeds
those bytes and writes them to `TMPDIR` before `dlopen`.

## License

MIT
