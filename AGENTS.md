# AGENTS.md

Utilities for `deno desktop` raw windows (input session, DOM-shaped events,
requestAnimationFrame) plus a standalone Web Audio subset. Intended for JSR.
Comments, commit messages, and this file are English.

`README.md` is the public doc: MDN links for the Web-shaped API (URLs without
`/en-US`, so MDN redirects by locale), then OS-specific differences from the
standard, then known `deno desktop` host bugs. Those host bugs start at
[denoland/deno#36752](https://github.com/denoland/deno/issues/36752) (raw IME
off) and [denoland/deno#36738](https://github.com/denoland/deno/issues/36738)
(`getNativeWindow()` panics off-main on macOS); Related on those tickets reaches
#36594 (no raw `.app` on aarch64-apple-darwin) and #36001 (Windows raw WebGPU
`present()` panic). Do not re-explain MDN types in the README or in source
comments.

## Commands

- Check: `deno task check` (`lint` + `fmt --check` + `test`)
- Tests: `deno task test`
- Format: `deno task fmt`
- Native helper: `deno task build:native -- build` (optional
  `--target <triple>`)
- Linux from macOS/Windows (Docker + `rust:1-bookworm`):
  `deno task build:native -- build --target aarch64-unknown-linux-gnu`
- CI: `.github/workflows/ci.yml` (`fmt`, `lint`, `test` on Ubuntu, macOS and
  Windows)
- Release: Actions → Release (workflow_dispatch version). Needs JSR OIDC and
  `RELEASE_PAT` so the version bump PR can wait on required checks. Bump with
  `deno run --allow-read --allow-write tools/bump_version.ts <version>`

Runtime needs `--allow-ffi --allow-read --allow-write --allow-env`. Tests also
take `--allow-run`.

## Architecture

- Public surface (`mod.ts`, `src/platforms/*`) is browser-shaped: `attach`,
  `InputSession`, `Screen`, DOM event classes. `requestAnimationFrame` /
  `cancelAnimationFrame` live on the session `attach` returns, along with
  `devicePixelRatio`, `screenX` / `screenY`, `innerWidth` / `innerHeight`,
  `outerWidth` / `outerHeight`, and `screen`. Audio (`AudioContext` and nodes)
  is a standalone `mod.ts` export, not on `InputSession`. Do not export key
  tables, inspect symbols, or native internals.
- Web Audio lives in TypeScript (`src/audio/`). The native helper is a PCM sink
  (`rdu_audio_*`, cpal + lock-free ring). Quantum size comes from
  `AudioContextOptions.renderSizeHint` / `renderQuantumSize` (default 128).
  After changing `native/rdu/src/audio.rs`, rebuild the prebuilt. ABI is 3.
- `InputSession.poll()` diffs a native snapshot plus a queued event list into
  Pointer / Mouse / Wheel / Keyboard / Composition events. The session also
  polls on native wakeup (`rdu_set_notify`, macOS / Linux) and immediately
  before `requestAnimationFrame` callbacks. Listeners go on the **session**, not
  `BrowserWindow` (that source can double-fire). Keep `poll()` for tests and
  Windows (no wakeup yet). On macOS the queue is a local NSEvent monitor plus a
  4 ms Combined Session button and key sampler. Do not add a CGEvent tap or
  global monitor (those need Input Monitoring / Accessibility). Quartz posts
  update `mouseLocation` (hover works) but often skip the local monitor and
  `NSEvent.pressedMouseButtons`. Off-main AppKit work hops to the main queue
  when it pumps, and runs inline under `deno test` so `exec_sync` cannot
  deadlock. Never invoke JS from the monitor, hook, or sampler: `wakeup.rs`
  calls the isolate from its own thread.
- Coordinates are content-view logical pixels, **top-left** origin (`clientX` /
  `clientY`), in the same space as `window.getSize()`.
- Native helper is the Rust cdylib `native/rdu`. macOS is AppKit (`macos.rs`);
  Linux dispatches like laufey_winit (`WAYLAND_DISPLAY` set → Wayland in
  `linux/wayland.rs`, else X11 via `x11rb` in `linux/x11.rs`); Windows is Win32
  (`windows.rs`, `windows-sys`). `stub.rs` is now only the fallback for other
  targets. Linux prebuilts are produced in Docker so they can be built on a Mac.
  Wayland cannot list other clients: pass `options.native` /
  `getNativeWindow().windowHandle` (and `displayHandle`).
- `attach` locates the view by `options.native` or title first. It must not call
  `BrowserWindow.getNativeWindow()` on macOS unless those fail: the raw backend
  panics off the main thread (`can only access NSView on the main thread`;
  denoland/deno#36738). Linux still falls back to `getNativeWindow` for the
  Wayland display pointer.
- Runtime always loads `native/prebuilt/<os>-<arch>.*` (embedded as bytes,
  written to `TMPDIR`). It does not invoke `cargo`. JSR `publish.include` is
  `native/prebuilt/**` only.

## Hard rules

- Comments are short and only explain a non-obvious constraint. Do not restate
  the identifier, narrate the implementation, or paste README / MDN text into
  the source. A long "why" belongs in this file or in `README.md`.
- After changing `native/rdu`, run `deno task build:native -- build` and commit
  the updated prebuilt. A same-sized cache file in `TMPDIR` is not proof it is
  current (path includes a checksum).
- On macOS, stay in screen space. Cursor Y is `NSMaxY(viewOnScreen) - screen.y`.
  Do not use `convertPoint` or `isFlipped` on winit views; those invert hit
  tests.
- On Windows, report client pixels **unscaled**. Whatever the host does with the
  requested size, `GetClientRect` and `getSize()` agree: the webview backend
  keeps a 640x480 window 640x480 physical at 150%, and the raw backend makes it
  960x720 and reports 960x720. Dividing by `GetDpiForWindow` would put `clientX`
  in a different space from `getSize()` and the drawing surface.
- The Windows helper captures input with a thread-local `WH_GETMESSAGE` hook on
  the window's thread (the analogue of the macOS local monitor). It only reads
  messages when `wParam == PM_REMOVE`, otherwise a `PeekMessage` without
  `PM_REMOVE` reports them twice.
- That hook is not enough on its own, so `rdu_attach` also registers raw input
  with `RIDEV_INPUTSINK`. When `deno desktop` runs on its WebView2 backend the
  window under the cursor belongs to a separate `msedgewebview2` process, and
  wheel and key messages are queued there, never to this thread — only the
  `GetCursorPos` / `GetAsyncKeyState` snapshot survives. `WM_INPUT` is delivered
  to our own window whoever has focus. Never set `RIDEV_NOLEGACY`: the host
  still needs its own input. Both paths stay live, so `push` drops an event the
  two of them both reported.
- Anything the Windows helper reads for a raw-input event must come from an
  async / global API. `GetKeyState` and `GetKeyboardState` are synchronized to
  the messages this thread has already taken off its queue, and raw input runs
  ahead of those (under WebView2 they never arrive), so a Shift keydown would
  report `shiftKey: false`. `GetAsyncKeyState` is the honest source; the Caps
  Lock toggle bit is the one exception, since it has no async form.
- Windows composition is read from IMM32 (`ImmGetCompositionStringW`,
  `GCS_COMPSTR`) and diffed in `rdu_poll_events`, not taken from `WM_IME_*`. An
  idle context answers 0 bytes exactly like a composition with no text, so
  "composing" means the string is non-empty. Do not associate an IME context on
  the host's behalf: winit IME is off (denoland/deno#36752), and
  `ImmAssociateContextEx` from here still will not compose. Until the host calls
  `set_ime_allowed(true)`, these events never fire.
- Linux cannot report composition at all. Both backends observe another client's
  window from their own connection, and preedit lives between that client and
  the IM server: X11 XIM is a private conversation with the IM window, and
  `zwp_text_input_v3` only ever reaches the client that owns the focused
  surface. `MOD_CAPS` works on both (X11 `KeyButMask::LOCK`, Wayland
  `mods_locked` bit 1); Wayland has no `MOD_REPEAT` because the compositor sends
  no repeats — clients synthesize them from `repeat_info`.
- `poll()` drains the native queue _before_ taking the snapshot, and a queued
  press or release for a button whose edge the snapshot already reported is
  dropped. Otherwise the two sources replay each other's edges. Because either
  source can win, `detail` is threaded across polls in `SynthResult.clickCounts`
  — the release has to report the count of the press it ends, or `dblclick`
  never fires.
- Close a native audio sink you opened. `AudioContext` only closes a sink it
  created itself, and a leaked one takes the process down with an access
  violation: Deno unloads the library at teardown while the audio callback is
  still running inside it.
- Split OS key maps (`src/keys/{macos,windows,linux}.ts`). The decoder takes a
  `KeyTranslator`; it must not import a macOS table. Bundlers should import
  `@petamoriken/raw-desktop-utils/macos` (or `/windows`, `/linux`) so unused
  backends drop out.
- `.gitattributes` pins the working tree to LF. `deno fmt` only writes LF, so a
  Windows checkout with `core.autocrlf=true` cannot pass `deno fmt --check`
  without it.
- Event / session inspect uses `Symbol.for("Deno.customInspect")` and a
  `#field in this` brand check. Logging `Foo.prototype` must not throw.
- Tests live in `tests/`. Keep `deno task check` green.

## Verify

This is not a browser. After input, hit-test, or native ABI changes:

1. `deno task check`
2. If Rust changed, confirm `native/prebuilt/` was regenerated
3. For real pointer/click behavior, run `deno task example` and hover/click the
   content view. Close chrome is left to `deno desktop` (`BrowserWindow`
   `"close"` + `Deno.exit`). On aarch64-apple-darwin that task wraps
   `laufey_winit` as `hit-test.app` (denoland/deno#36594); elsewhere it runs
   `deno desktop`.
