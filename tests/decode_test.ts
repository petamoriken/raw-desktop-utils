import { assertEquals } from "@std/assert";
import { macKeys } from "../src/keys/macos.ts";
import { QUEUED_EVENT_BYTES, SNAPSHOT_BYTES } from "../src/native/abi.ts";
import { decodeQueuedEvent, decodeSnapshot } from "../src/native/decode.ts";
import type { KeyTranslator } from "../src/keys/types.ts";
import { MOD_CAPS, MOD_COMPOSING, MOD_REPEAT } from "../src/types.ts";

Deno.test("snapshot decoder reads little-endian packed fields", () => {
  const buf = new ArrayBuffer(SNAPSHOT_BYTES);
  const v = new DataView(buf);
  v.setUint32(0, 1 | 2 | 4, true); // inside, focused, valid
  v.setFloat32(4, 12.5, true);
  v.setFloat32(8, 40, true);
  v.setFloat32(12, 100, true);
  v.setFloat32(16, 200, true);
  v.setUint32(20, 1, true);
  v.setUint32(24, 1 | 8, true); // shift+meta
  v.setFloat32(28, 0.5, true);
  v.setFloat32(32, 10, true);
  v.setFloat32(36, -5, true);
  v.setFloat32(40, 15, true);
  v.setUint32(44, 1, true); // pen
  v.setFloat32(48, 2, true);
  v.setFloat32(52, 10, true);
  v.setFloat32(56, 20, true);
  v.setFloat32(60, 800, true);
  v.setFloat32(64, 600, true);
  v.setFloat32(68, 820, true);
  v.setFloat32(72, 640, true);
  v.setFloat32(76, 1920, true);
  v.setFloat32(80, 1080, true);
  v.setFloat32(84, 0, true);
  v.setFloat32(88, 25, true);
  v.setFloat32(92, 1920, true);
  v.setFloat32(96, 1055, true);
  const snap = decodeSnapshot(new Uint8Array(buf));
  assertEquals(snap.valid, true);
  assertEquals(snap.inside, true);
  assertEquals(snap.focused, true);
  assertEquals(snap.clientX, 12.5);
  assertEquals(snap.clientY, 40);
  assertEquals(snap.viewWidth, 800);
  assertEquals(snap.viewHeight, 600);
  assertEquals(snap.buttons, 1);
  assertEquals(snap.pointerType, "pen");
  assertEquals(snap.pressure, 0.5);
  assertEquals(snap.devicePixelRatio, 2);
  assertEquals(snap.windowX, 10);
  assertEquals(snap.windowY, 20);
  assertEquals(snap.outerWidth, 820);
  assertEquals(snap.outerHeight, 640);
  assertEquals(snap.screenWidth, 1920);
  assertEquals(snap.screenHeight, 1080);
  assertEquals(snap.availTop, 25);
  assertEquals(snap.availHeight, 1055);
});

Deno.test("queued event decoder uses the supplied key translator", () => {
  const buf = new Uint8Array(QUEUED_EVENT_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 4, true); // keydown
  v.setUint32(20, 0, true);
  v.setUint32(72, 1, true);
  buf[76] = 0x61; // "a"

  const ev = decodeQueuedEvent(buf, 0, macKeys);
  assertEquals(ev.type, 4);
  assertEquals(ev.code, "KeyA");
  assertEquals(ev.key, "a");
  assertEquals(ev.repeat, false);
  assertEquals(ev.isComposing, false);

  const custom: KeyTranslator = {
    codeFromKeyCode: () => "CustomCode",
    keyFromEvent: (_keyCode, chars) => `k:${chars}`,
  };
  const mapped = decodeQueuedEvent(buf, 0, custom);
  assertEquals(mapped.code, "CustomCode");
  assertEquals(mapped.key, "k:a");
});

Deno.test("queued key decoder reads repeat, composing, and CapsLock bits", () => {
  const buf = new Uint8Array(QUEUED_EVENT_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 4, true);
  v.setUint32(12, MOD_CAPS | MOD_REPEAT | MOD_COMPOSING, true);
  v.setUint32(20, 0, true);
  const ev = decodeQueuedEvent(buf, 0, macKeys);
  assertEquals(ev.repeat, true);
  assertEquals(ev.isComposing, true);
  assertEquals((ev.modifiers & MOD_CAPS) !== 0, true);
});
