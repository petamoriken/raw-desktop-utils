# raw-desktop-events

UI Events and Pointer Events for
[`deno desktop`](https://docs.deno.com/runtime/desktop/) **raw** mode.

A raw `Deno.BrowserWindow` has no DOM, so `PointerEvent`, `MouseEvent.offsetX`,
and the rest of the UI Events model are missing or unusable. This library reads
the OS pointer (and queued click / wheel / key events) through FFI and
synthesizes the same event shapes a browser would dispatch.

macOS is implemented. Windows and Linux export the same native ABI but are not
implemented yet — see the stubs in `native/rde-events/src/stub.rs`.

## Install

Intended for [JSR](https://jsr.io). Until it is published, import from the repo
path:

```ts
import { attach, requestAnimationFrame } from "../raw-desktop-events/mod.ts";
```

Vite / esbuild should import a platform subpath so unused OS backends and key
tables are dropped from the bundle:

```ts
import { attach } from "raw-desktop-events/macos";
```

Permissions: `--allow-ffi --allow-read --allow-write --allow-env` (add
`--allow-run` only if you rebuild from Rust with `RDE_COMPILE=1`). By default
the package loads a committed prebuilt (`native/prebuilt/`) so a `deno desktop`
/ `deno compile` host does not need `cargo` or `clang`. Rebuild and refresh the
prebuilt with `deno task build:native`. Set `RDE_COMPILE=1` to build the crate
on the fly instead.

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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

`addEventListener` is typed like the DOM: `"pointermove"` gives a
`PointerEvent`, `"wheel"` a `WheelEvent`, `"keydown"` a `KeyboardEvent`.
`requestAnimationFrame` / `cancelAnimationFrame` match the HTML `Window` methods
(a display-aligned polyfill when the runtime has none).

Listen on the **session**, not on `BrowserWindow`. The window may still emit
incomplete mouse events; mixing the two sources can double-fire clicks.

`attach` options:

| Option            | Meaning                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `title`           | Locate the native content view by window title (required on macOS unless you pass `native`). |
| `native`          | Existing `NSView*` / `HWND` / etc.                                                           |
| `target`          | Extra `EventTarget` that also receives copies of each event.                                 |
| `mouseEvents`     | Also fire `mousedown` / `click` / `contextmenu` (default `true`).                            |
| `autoPoll`        | Interval in ms; omit to poll yourself.                                                       |
| `locateTimeoutMs` | How long to wait for the window to appear (default 500).                                     |

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

The public exports are the DOM constructors (`PointerEvent`, `MouseEvent`,
`WheelEvent`, `KeyboardEvent`, `UIEvent`) plus `attach`. Platform key tables and
inspect internals stay private.

## Native ABI

The helper is a Rust `cdylib` (`native/rde-events`). macOS is implemented;
Windows and Linux export the same C symbols as stubs so they can be filled in on
those machines.

```sh
deno task build:native
# optional:
deno task build:native -- --target aarch64-apple-darwin
```

That writes `native/prebuilt/<os>-<arch>.{dylib,dll,so}`. Runtime code embeds
those bytes and writes them to `TMPDIR` before `dlopen`.

## License

MIT
