# AGENTS.md

Utilities for `deno desktop` raw windows (input session, DOM-shaped events,
requestAnimationFrame). Intended for JSR. Comments, commit messages, and this
file are English.

## Commands

- Check: `deno task check` (`lint` + `fmt --check` + `test`)
- Tests: `deno task test`
- Format: `deno task fmt`
- Native helper: `deno task build:native -- build` (optional
  `--target <triple>`)
- Linux from macOS/Windows (Docker + `rust:1-bookworm`):
  `deno task build:native -- build --target aarch64-unknown-linux-gnu`
- CI: `.github/workflows/ci.yml` (`fmt`, `lint`, `test` on Ubuntu and macOS)
- Release: Actions → Release (workflow_dispatch version). Needs JSR OIDC and
  `RELEASE_PAT` so the version bump PR can wait on required checks. Bump with
  `deno run --allow-read --allow-write tools/bump_version.ts <version>`

Runtime needs `--allow-ffi --allow-read --allow-write --allow-env`. Tests also
take `--allow-run`.

## Architecture

- Public surface (`mod.ts`, `src/platforms/*`) is browser-shaped: `attach`,
  `InputSession`, DOM event classes. `requestAnimationFrame` /
  `cancelAnimationFrame` live on the session `attach` returns. Do not export key
  tables, inspect symbols, or native internals.
- `InputSession.poll()` diffs a native snapshot plus a queued event list into
  Pointer / Mouse / Wheel / Keyboard events. Listeners go on the **session**,
  not `BrowserWindow` (that source can double-fire).
- Coordinates are content-view logical pixels, **top-left** origin (`clientX` /
  `clientY`).
- Native helper is the Rust cdylib `native/rde-events`. macOS is AppKit
  (`macos.rs`); Linux dispatches like laufey_winit (`WAYLAND_DISPLAY` set →
  Wayland in `linux/wayland.rs`, else X11 via `x11rb` in `linux/x11.rs`);
  Windows is still a stub (`stub.rs`). Linux prebuilts are produced in Docker so
  they can be built on a Mac. Wayland cannot list other clients: pass
  `options.native` / `getNativeWindow().windowHandle` (and `displayHandle`).
- Runtime always loads `native/prebuilt/<os>-<arch>.*` (embedded as bytes,
  written to `TMPDIR`). It does not invoke `cargo`. JSR `publish.include` is
  `native/prebuilt/**` only.

## Hard rules

- After changing `native/rde-events`, run `deno task build:native -- build` and
  commit the updated prebuilt. A same-sized cache file in `TMPDIR` is not proof
  it is current (path includes a checksum).
- On macOS, stay in screen space. Cursor Y is `NSMaxY(viewOnScreen) - screen.y`.
  Do not use `convertPoint` or `isFlipped` on winit views; those invert hit
  tests.
- Split OS key maps (`src/keys/{macos,windows,linux}.ts`). The decoder takes a
  `KeyTranslator`; it must not import a macOS table. Bundlers should import
  `@petamoriken/raw-desktop-utils/macos` (or `/windows`, `/linux`) so unused
  backends drop out.
- Event / session inspect uses `Symbol.for("Deno.customInspect")` and a
  `#field in this` brand check. Logging `Foo.prototype` must not throw.
- Tests live in `tests/`. Keep `deno task check` green.

## Verify

This is not a browser. After input, hit-test, or native ABI changes:

1. `deno task check`
2. If Rust changed, confirm `native/prebuilt/` was regenerated
3. For real pointer/click behavior, run a `deno desktop` raw app (see
   `examples/basic.ts`) and hover/click the content view
