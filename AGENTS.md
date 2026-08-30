# AGENTS.md

FFI-backed UI Events / Pointer Events for `deno desktop` raw mode. Intended for JSR. Comments, commit messages, and this file are English.

## Commands

- Check: `deno task check` (`lint` + `fmt --check` + `test`)
- Tests: `deno task test`
- Format: `deno task fmt`
- Native helper: `deno task build:native` (optionally `-- --target <triple>`)

Runtime needs `--allow-ffi --allow-read --allow-write --allow-env`. Tests also take `--allow-run`.

## Architecture

- Public surface (`mod.ts`, `src/platforms/*`) is browser-shaped: `attach`, `InputSession`, DOM event classes, `requestAnimationFrame` / `cancelAnimationFrame`. Do not export key tables, inspect symbols, or native internals.
- `InputSession.poll()` diffs a native snapshot plus a queued event list into Pointer / Mouse / Wheel / Keyboard events. Listeners go on the **session**, not `BrowserWindow` (that source can double-fire).
- Coordinates are content-view logical pixels, **top-left** origin (`clientX` / `clientY`).
- Native helper is the Rust cdylib `native/rde-events`. macOS (`src/macos.rs`) is real; Windows / Linux are stubs in `src/stub.rs` with the same C ABI.
- Runtime always loads `native/prebuilt/<os>-<arch>.*` (embedded as bytes, written to `TMPDIR`). It does not invoke `cargo`. JSR `publish.include` is `native/prebuilt/**` only.

## Hard rules

- After changing `native/rde-events`, run `deno task build:native` and commit the updated prebuilt. A same-sized cache file in `TMPDIR` is not proof it is current (path includes a checksum).
- On macOS, stay in screen space. Cursor Y is `NSMaxY(viewOnScreen) - screen.y`. Do not use `convertPoint` or `isFlipped` on winit views; those invert hit tests.
- Split OS key maps (`src/keys/{macos,windows,linux}.ts`). The decoder takes a `KeyTranslator`; it must not import a macOS table. Bundlers should import `raw-desktop-events/macos` (or `/windows`, `/linux`) so unused backends drop out.
- Event / session inspect uses `Symbol.for("Deno.customInspect")` and a `#field in this` brand check. Logging `Foo.prototype` must not throw.
- Tests live in `tests/`. Keep `deno task check` green.

## Verify

This is not a browser. After input, hit-test, or native ABI changes:

1. `deno task check`
2. If Rust changed, confirm `native/prebuilt/` was regenerated
3. For real pointer/click behavior, run a `deno desktop` raw app (see `examples/basic.ts`) and hover/click the content view
