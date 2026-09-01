import { locationFromCode } from "../keys/shared.ts";
import type { KeyTranslator } from "../keys/types.ts";
import {
  emptySnapshot,
  MOD_COMPOSING,
  MOD_REPEAT,
  NATIVE_EVENT_COMPOSITION_START,
  type NativeEventKind,
  type NativeQueuedEvent,
  type PointerSnapshot,
  pointerTypeFromNative,
} from "../types.ts";
import {
  FLAG_FOCUSED,
  FLAG_INSIDE,
  FLAG_VALID,
  QUEUED_EVENT_BYTES,
  QUEUED_KEY_BYTES,
  SNAPSHOT_BYTES,
} from "./abi.ts";

export function decodeSnapshot(buf: Uint8Array): PointerSnapshot {
  if (buf.byteLength < SNAPSHOT_BYTES) return emptySnapshot();
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const flags = v.getUint32(0, true);
  // Offsets match `abi.rs` Snapshot: pointer, then window, then screen.
  return {
    valid: (flags & FLAG_VALID) !== 0,
    inside: (flags & FLAG_INSIDE) !== 0,
    focused: (flags & FLAG_FOCUSED) !== 0,
    clientX: v.getFloat32(4, true),
    clientY: v.getFloat32(8, true),
    screenX: v.getFloat32(12, true),
    screenY: v.getFloat32(16, true),
    buttons: v.getUint32(20, true),
    modifiers: v.getUint32(24, true),
    pressure: v.getFloat32(28, true),
    tiltX: v.getFloat32(32, true),
    tiltY: v.getFloat32(36, true),
    twist: v.getFloat32(40, true),
    pointerType: pointerTypeFromNative(v.getUint32(44, true)),
    devicePixelRatio: v.getFloat32(48, true),
    windowX: v.getFloat32(52, true),
    windowY: v.getFloat32(56, true),
    viewWidth: v.getFloat32(60, true),
    viewHeight: v.getFloat32(64, true),
    outerWidth: v.getFloat32(68, true),
    outerHeight: v.getFloat32(72, true),
    screenWidth: v.getFloat32(76, true),
    screenHeight: v.getFloat32(80, true),
    availLeft: v.getFloat32(84, true),
    availTop: v.getFloat32(88, true),
    availWidth: v.getFloat32(92, true),
    availHeight: v.getFloat32(96, true),
  };
}

export function decodeQueuedEvent(
  buf: Uint8Array,
  offset: number,
  keys: KeyTranslator,
): NativeQueuedEvent {
  const v = new DataView(
    buf.buffer,
    buf.byteOffset + offset,
    QUEUED_EVENT_BYTES,
  );
  const keyLen = Math.min(v.getUint32(72, true), QUEUED_KEY_BYTES);
  const chars = keyLen > 0
    ? new TextDecoder().decode(buf.subarray(offset + 76, offset + 76 + keyLen))
    : "";
  const keyCode = v.getUint32(20, true);
  const code = keys.codeFromKeyCode(keyCode);
  const modifiers = v.getUint32(12, true);
  const type = v.getUint32(0, true) as NativeEventKind;
  // A composition event carries its `data` in the same field, and that is
  // already the text: naming it as a key would turn an empty composition into
  // `"Unidentified"`.
  const composition = type >= NATIVE_EVENT_COMPOSITION_START;
  return {
    type,
    button: v.getUint32(4, true),
    buttons: v.getUint32(8, true),
    modifiers,
    clickCount: v.getUint32(16, true),
    keyCode,
    clientX: v.getFloat32(24, true),
    clientY: v.getFloat32(28, true),
    screenX: v.getFloat32(32, true),
    screenY: v.getFloat32(36, true),
    deltaX: v.getFloat32(40, true),
    deltaY: v.getFloat32(44, true),
    deltaZ: v.getFloat32(48, true),
    deltaMode: 0,
    pressure: v.getFloat32(52, true),
    tiltX: v.getFloat32(56, true),
    tiltY: v.getFloat32(60, true),
    twist: v.getFloat32(64, true),
    pointerType: pointerTypeFromNative(v.getUint32(68, true)),
    key: composition ? chars : keys.keyFromEvent(keyCode, chars),
    code,
    location: locationFromCode(code),
    repeat: (modifiers & MOD_REPEAT) !== 0,
    isComposing: (modifiers & MOD_COMPOSING) !== 0,
  };
}

export function decodeQueuedEvents(
  buf: Uint8Array,
  count: number,
  keys: KeyTranslator,
): NativeQueuedEvent[] {
  const out: NativeQueuedEvent[] = [];
  for (let i = 0; i < count; i++) {
    const offset = i * QUEUED_EVENT_BYTES;
    if (offset + QUEUED_EVENT_BYTES > buf.byteLength) break;
    out.push(decodeQueuedEvent(buf, offset, keys));
  }
  return out;
}
