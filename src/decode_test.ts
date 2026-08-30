import { assertEquals } from "@std/assert";
import { QUEUED_EVENT_BYTES, SNAPSHOT_BYTES } from "./native/abi.ts";
import { decodeQueuedEvent, decodeSnapshot } from "./native/decode.ts";

Deno.test("snapshot decoder reads little-endian packed fields", () => {
  const buf = new ArrayBuffer(SNAPSHOT_BYTES);
  const v = new DataView(buf);
  v.setUint32(0, 1 | 2 | 4, true); // inside, focused, valid
  v.setFloat32(4, 12.5, true);
  v.setFloat32(8, 40, true);
  v.setFloat32(12, 100, true);
  v.setFloat32(16, 200, true);
  v.setFloat32(20, 800, true);
  v.setFloat32(24, 600, true);
  v.setUint32(28, 1, true);
  v.setUint32(32, 1 | 8, true); // shift+meta
  v.setFloat32(36, 0.5, true);
  v.setFloat32(40, 10, true);
  v.setFloat32(44, -5, true);
  v.setFloat32(48, 15, true);
  v.setUint32(52, 1, true); // pen
  const snap = decodeSnapshot(new Uint8Array(buf));
  assertEquals(snap.valid, true);
  assertEquals(snap.inside, true);
  assertEquals(snap.focused, true);
  assertEquals(snap.clientX, 12.5);
  assertEquals(snap.clientY, 40);
  assertEquals(snap.buttons, 1);
  assertEquals(snap.pointerType, "pen");
  assertEquals(snap.pressure, 0.5);
});

Deno.test("queued event decoder maps mac keyCode and UTF-8 key", () => {
  const buf = new Uint8Array(QUEUED_EVENT_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 4, true); // keydown
  v.setUint32(20, 0, true); // KeyA
  v.setUint32(72, 1, true);
  buf[76] = 0x61; // "a"
  const ev = decodeQueuedEvent(buf, 0);
  assertEquals(ev.type, 4);
  assertEquals(ev.code, "KeyA");
  assertEquals(ev.key, "a");
});
