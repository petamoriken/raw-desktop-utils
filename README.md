# raw-desktop-utils

Utilities for [`deno desktop`](https://docs.deno.com/runtime/desktop/) raw
`BrowserWindow`s. `attach(window)` returns an `InputSession`. Native click /
wheel / key events wake the session; `requestAnimationFrame` also samples the
pointer before the callback. Listen on the **session**, not on `BrowserWindow`.
`poll()` is still there for tests.

Also a standalone
[Web Audio](https://developer.mozilla.org/docs/Web/API/Web_Audio_API) subset
(`AudioContext` and nodes). It does not need a window.

macOS (AppKit), Windows (Win32) and Linux (X11, or Wayland when
`WAYLAND_DISPLAY` is set) are implemented.

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
loads a committed prebuilt (`native/prebuilt/`). Refresh it in this repo with
`deno task build:native -- build`.

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
  game.draw();
  input.requestAnimationFrame(frame);
}
input.requestAnimationFrame(frame);
```

`attach` options:

| Option            | Meaning                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `title`           | Locate the content view by title. Works on macOS, Windows and X11, not Wayland. |
| `native`          | Existing `NSView*` / `HWND` / X11 window / `wl_surface*`.                       |
| `display`         | Wayland `wl_display*` (`getNativeWindow().displayHandle`).                      |
| `target`          | Extra `EventTarget` that also receives copies of each event.                    |
| `mouseEvents`     | Also fire `mousedown` / `click` / `contextmenu` (default `true`).               |
| `locateTimeoutMs` | How long to wait for the window to appear (default 500).                        |

`attach` finds the view from `options.native` or `title` first. It only calls
`window.getNativeWindow()` when those fail (or on Linux, for a Wayland
`displayHandle`). Prefer a title or an existing handle on macOS; see
[Known issues in deno desktop](#known-issues-in-deno-desktop).

## API

The public types match these Web APIs. Follow the MDN pages for fields and event
names (the locale prefix is omitted so MDN redirects to the reader's language).

### Input

- [`EventTarget`](https://developer.mozilla.org/docs/Web/API/EventTarget) /
  [`addEventListener`](https://developer.mozilla.org/docs/Web/API/EventTarget/addEventListener)
- [`UIEvent`](https://developer.mozilla.org/docs/Web/API/UIEvent)
- [`MouseEvent`](https://developer.mozilla.org/docs/Web/API/MouseEvent)
  (`click`, `dblclick`, `auxclick`, `contextmenu`, `mouse*`)
- [`PointerEvent`](https://developer.mozilla.org/docs/Web/API/PointerEvent)
- [`WheelEvent`](https://developer.mozilla.org/docs/Web/API/WheelEvent)
- [`KeyboardEvent`](https://developer.mozilla.org/docs/Web/API/KeyboardEvent)
  ([`key`](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/key),
  [`code`](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/code),
  [`repeat`](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/repeat),
  [`isComposing`](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/isComposing),
  [`getModifierState`](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/getModifierState))
- [`CompositionEvent`](https://developer.mozilla.org/docs/Web/API/CompositionEvent)
- [`Window.requestAnimationFrame`](https://developer.mozilla.org/docs/Web/API/Window/requestAnimationFrame)
  /
  [`cancelAnimationFrame`](https://developer.mozilla.org/docs/Web/API/Window/cancelAnimationFrame)
- Window geometry:
  [`devicePixelRatio`](https://developer.mozilla.org/docs/Web/API/Window/devicePixelRatio),
  [`screenX`](https://developer.mozilla.org/docs/Web/API/Window/screenX) /
  [`screenY`](https://developer.mozilla.org/docs/Web/API/Window/screenY)
  (`screenLeft` / `screenTop`),
  [`innerWidth`](https://developer.mozilla.org/docs/Web/API/Window/innerWidth) /
  [`innerHeight`](https://developer.mozilla.org/docs/Web/API/Window/innerHeight),
  [`outerWidth`](https://developer.mozilla.org/docs/Web/API/Window/outerWidth) /
  [`outerHeight`](https://developer.mozilla.org/docs/Web/API/Window/outerHeight)
- [`Screen`](https://developer.mozilla.org/docs/Web/API/Screen) (`input.screen`;
  fires `change` when the work area changes between polls)

### Audio

Standalone export. `new AudioContext()` starts
[`suspended`](https://developer.mozilla.org/docs/Web/API/AudioContext/state);
`await ctx.resume()` opens the default output. There is no user-gesture gate.

- [`AudioContext`](https://developer.mozilla.org/docs/Web/API/AudioContext)
  ([`renderSizeHint`](https://developer.mozilla.org/docs/Web/API/AudioContext/renderSizeHint)
  /
  [`renderQuantumSize`](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/renderQuantumSize))
- [`AudioBuffer`](https://developer.mozilla.org/docs/Web/API/AudioBuffer)
- [`AudioBufferSourceNode`](https://developer.mozilla.org/docs/Web/API/AudioBufferSourceNode)
- [`GainNode`](https://developer.mozilla.org/docs/Web/API/GainNode)
- [`OscillatorNode`](https://developer.mozilla.org/docs/Web/API/OscillatorNode)
- [`BiquadFilterNode`](https://developer.mozilla.org/docs/Web/API/BiquadFilterNode)
- [`AnalyserNode`](https://developer.mozilla.org/docs/Web/API/AnalyserNode)
- [`StereoPannerNode`](https://developer.mozilla.org/docs/Web/API/StereoPannerNode)
- [`AudioDestinationNode`](https://developer.mozilla.org/docs/Web/API/AudioDestinationNode)
- [`AudioListener`](https://developer.mozilla.org/docs/Web/API/AudioListener)
- [`AudioParam`](https://developer.mozilla.org/docs/Web/API/AudioParam)
- [`PeriodicWave`](https://developer.mozilla.org/docs/Web/API/PeriodicWave)

Factory methods (`createGain`, …) wrap the constructors. There is no
[`decodeAudioData`](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/decodeAudioData)
yet — build an `AudioBuffer` from PCM.

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

## Differences from the standard

There is no document tree. Events do not hit-test, capture, or bubble through
elements — they fire on the **session** (and on `options.target` if you pass
one). [`clientX`](https://developer.mozilla.org/docs/Web/API/MouseEvent/clientX)
/ [`clientY`](https://developer.mozilla.org/docs/Web/API/MouseEvent/clientY)
still use a top-left origin in the content view, the same space as `getSize()`.

A press that starts inside the view keeps sending `pointermove` after the cursor
leaves, with out-of-range coordinates, until the button comes up. That release
is not a `click`. A drag that started in another window stays silent.

[`getModifierState`](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/getModifierState)
answers `Alt`, `AltGraph`, `Control`, `Meta`, `Shift`, `CapsLock`, and `Accel`
(`Meta` on macOS, `Control` elsewhere). Other modifier names are `false`.
`capsLock` on `MouseEventInit` / `KeyboardEventInit` is an extension that seeds
that bit.

Composition events fire only when the host window is composing. On raw
`laufey_winit`, IME is on by default; `BrowserWindow.setImeAllowed` /
`setImeCursorArea` turn it on or off (no-op on WebView / CEF). See
[Known issues in deno desktop](#known-issues-in-deno-desktop).

### macOS

- `devicePixelRatio` is `2` on a Retina display, `1` otherwise.
- The window can be found by `title`. Prefer that or `native` over
  `getNativeWindow()`.

### Windows

- `devicePixelRatio` is `1`. `clientX` and `getSize()` already use the pixels
  the window occupies, even when the OS scale is 150%. Do not multiply by the
  display scale.
- `KeyboardEvent.code` assumes a US layout for punctuation keys. A numpad key
  with NumLock off arrives as its navigation key (`Home`, not `Numpad7`). `key`
  follows the active layout.
- No pen pressure or tilt.
- The window can be found by `title`.

### Linux

- X11: `devicePixelRatio` is `1`. The window can be found by `title`.
- Wayland: pass `options.native` and `display`. There is no title lookup.
  `screenX` and `outer*` stay `0`; inner size falls back to `getSize()`.
  `KeyboardEvent.repeat` is always `false`.
- No composition events.
- `KeyboardEvent.code` is empty. `key` is the character that was typed.

## Known issues in deno desktop

These are host bugs, not this library. Start from the two tickets below; the
others are linked from their Related sections.

- [denoland/deno#36752](https://github.com/denoland/deno/issues/36752) — Windows
  raw IME is off (`ImmGetContext` is null). winit's default is
  `set_ime_allowed(false)`, and `deno desktop` never turns it on. WebView2
  composes; raw never does. The same default hits the other raw backends: macOS
  still delivers keydowns, but marked text / composition UI usually never
  attach; Linux still delivers keys, but XIM / `zwp_text_input` preedit never
  sits on the window. CJK text in a raw window is not possible on any OS until
  the host enables IME.
- [denoland/deno#36738](https://github.com/denoland/deno/issues/36738) — macOS
  raw `getNativeWindow()` panics off the main thread
  (`can only access NSView on the main thread`). That is also why this library
  locates the view by title / `native` first.
  - [denoland/deno#36594](https://github.com/denoland/deno/issues/36594) —
    `deno desktop` cannot launch the raw backend on `aarch64-apple-darwin` (no
    `.app` bundle). `deno task example` wraps `laufey_winit` as `hit-test.app`
    as a workaround.
  - [denoland/deno#36001](https://github.com/denoland/deno/issues/36001) —
    Windows raw WebGPU `present()` panics (`RefCell already mutably borrowed`).

`BrowserWindow` can still emit incomplete mouse events and double-fire; listen
on the session. Raw winit `requestAnimationFrame` does not tick unless something
presents. On macOS and Linux the native helper wakes the session for queued
events, so listeners still run. On Windows, call `poll()` or present so host rAF
ticks.

## Native helper

The helper is a Rust `cdylib` (`native/rdu`). Runtime code embeds
`native/prebuilt/<os>-<arch>.{dylib,dll,so}` and writes it to `TMPDIR`.

```sh
deno task build:native -- build
deno task build:native -- build --target aarch64-apple-darwin
deno task build:native -- build --target aarch64-unknown-linux-gnu
deno task build:native -- build --target x86_64-unknown-linux-gnu
```

Linux `.so` files are built with Docker when the host is not Linux.

## License

MIT
