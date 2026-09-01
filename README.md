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

macOS (AppKit), Windows (Win32) and Linux (X11, or Wayland when
`WAYLAND_DISPLAY` is set) are implemented. Linux `.so` files are built with
Docker when the host is not Linux
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
`Window` methods. The session also exposes the same geometry as a `Window`:
`devicePixelRatio`, `screenX` / `screenY` (`screenLeft` / `screenTop`),
`innerWidth` / `innerHeight`, `outerWidth` / `outerHeight`, and `input.screen`
(`Screen extends EventTarget`). `screen` fires `change` when the monitor work
area changes between polls.

`attach` options:

| Option            | Meaning                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`           | Locate the native content view by window title (required on macOS unless you pass `native`). Title search works on macOS, Windows and X11, but not Wayland. |
| `native`          | Existing `NSView*` / `HWND` / X11 window / `wl_surface*`.                                                                                                   |
| `display`         | Wayland `wl_display*` (`getNativeWindow().displayHandle`). Optional if the surface can yield it.                                                            |
| `target`          | Extra `EventTarget` that also receives copies of each event.                                                                                                |
| `mouseEvents`     | Also fire `mousedown` / `click` / `contextmenu` (default `true`).                                                                                           |
| `autoPoll`        | Interval in ms; omit to poll yourself.                                                                                                                      |
| `locateTimeoutMs` | How long to wait for the window to appear (default 500).                                                                                                    |

`attach` finds the content view from `options.native` or `title` first. It only
calls `window.getNativeWindow()` when those fail (or on Linux, to pick up a
Wayland `displayHandle`). On macOS `deno desktop` raw, `getNativeWindow()` can
panic off the main thread, so a title or an existing `NSView*` is the supported
path.

Coordinates use a **top-left** origin in logical (point) pixels of the content
view, the same space as `window.getSize()`. That matches CSS `clientX` /
`clientY`. `devicePixelRatio` is the physical backing size of that space (Retina
`2`, Windows unscaled `1`). On macOS the helper stays in screen space and flips
Y; it does not call `convertPoint` / `isFlipped` on winit views, which invert
hit tests. On Windows client pixels are reported unscaled: whatever the host
does with the requested size, `GetClientRect` and `getSize()` agree (the webview
backend keeps a 640x480 window 640x480 physical at 150%, the raw backend makes
it 960x720 and reports 960x720).

## Events

From a live snapshot plus the native queue:

- `pointerover` / `pointerenter` / `pointermove` / `pointerdown` / `pointerup` /
  `pointerout` / `pointerleave`
- compatibility `mouse*` , `click`, `dblclick`, `auxclick`, `contextmenu`
- `wheel`
- `keydown` / `keyup`
- `compositionstart` / `compositionupdate` / `compositionend`

Composition events come from the OS IME, so they follow what the host window
allows. macOS reports them from marked text. Windows reads IMM32, which stays
quiet until `deno desktop` builds its window with IME enabled — winit turns IME
off by default and there is no option for it yet. Linux never reports them: both
backends watch another client's window from their own connection, and preedit
never leaves the client that owns the focused surface. `KeyboardEvent`
everywhere carries `repeat`, `isComposing`, and `getModifierState("CapsLock")`
(Wayland has no `repeat`: the compositor sends none).

The public exports are `attach`, `InputSession`, `Screen`, the DOM constructors
(`PointerEvent`, `MouseEvent`, `WheelEvent`, `KeyboardEvent`,
`CompositionEvent`, `UIEvent`), and a Web Audio subset (`AudioContext`,
`AudioBuffer`, nodes). Platform key tables and inspect internals stay private.

## Audio

`AudioContext` is a standalone export. It does not need `attach()` or a window.
`new AudioContext()` starts `suspended`; `await ctx.resume()` opens the default
output device. There is no user-gesture gate.

```ts
import {
  AudioBuffer,
  AudioBufferSourceNode,
  AudioContext,
} from "jsr:@petamoriken/raw-desktop-utils";

const ctx = new AudioContext({ renderSizeHint: 256 });
await ctx.resume();

const shot = new AudioBuffer({
  length: pcm.length,
  numberOfChannels: 1,
  sampleRate: ctx.sampleRate,
});
shot.copyToChannel(pcm, 0);
const src = new AudioBufferSourceNode(ctx, { buffer: shot });
src.connect(ctx.destination);
src.start();
```

`renderSizeHint` is the Web Audio 1.1 option (`"default"` / omitted → 128, a
positive integer asks for that quantum, `"hardware"` lets the implementation
pick). The chosen size is `ctx.renderQuantumSize` and stays fixed. Numeric hints
must be in `[1, floor(6 * sampleRate)]`.

v1 nodes: `AudioBufferSourceNode`, `GainNode`, `OscillatorNode`,
`BiquadFilterNode`, `AnalyserNode`, `StereoPannerNode`. Factory methods
(`createGain`, …) wrap the constructors. There is no `decodeAudioData` yet —
build an `AudioBuffer` from PCM.

## Native ABI

The helper is a Rust `cdylib` (`native/rdu`). macOS is AppKit: a local NSEvent
monitor plus a Combined Session button sampler for synthesized clicks. It does
not request Accessibility or Input Monitoring. Windows is Win32: window lookup
through `EnumWindows`, live state from `GetCursorPos` / `GetAsyncKeyState`, and
discrete events from a thread-local `WH_GETMESSAGE` hook on the window's own
thread plus raw input registered with `RIDEV_INPUTSINK`, so the window procedure
is left alone and wheel and key events still arrive when the host puts its
content in another process (WebView2 does). Linux is X11 or Wayland (same
`WAYLAND_DISPLAY` rule as laufey_winit).

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
