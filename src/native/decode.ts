import { codeFromMacKeyCode, keyFromMac } from "../keys.ts";
import {
  emptySnapshot,
  pointerTypeFromNative,
  type NativeEventKind,
  type NativeQueuedEvent,
  type PointerSnapshot,
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
  return {
    valid: (flags & FLAG_VALID) !== 0,
    inside: (flags & FLAG_INSIDE) !== 0,
    focused: (flags & FLAG_FOCUSED) !== 0,
    clientX: v.getFloat32(4, true),
    clientY: v.getFloat32(8, true),
    screenX: v.getFloat32(12, true),
    screenY: v.getFloat32(16, true),
    viewWidth: v.getFloat32(20, true),
    viewHeight: v.getFloat32(24, true),
    buttons: v.getUint32(28, true),
    modifiers: v.getUint32(32, true),
    pressure: v.getFloat32(36, true),
    tiltX: v.getFloat32(40, true),
    tiltY: v.getFloat32(44, true),
    twist: v.getFloat32(48, true),
    pointerType: pointerTypeFromNative(v.getUint32(52, true)),
  };
}

export function decodeQueuedEvent(
  buf: Uint8Array,
  offset: number,
): NativeQueuedEvent {
  const v = new DataView(buf.buffer, buf.byteOffset + offset, QUEUED_EVENT_BYTES);
  const keyLen = Math.min(v.getUint32(72, true), QUEUED_KEY_BYTES);
  const chars = keyLen > 0
    ? new TextDecoder().decode(buf.subarray(offset + 76, offset + 76 + keyLen))
    : "";
  const keyCode = v.getUint32(20, true);
  const code = codeFromMacKeyCode(keyCode);
  return {
    type: v.getUint32(0, true) as NativeEventKind,
    button: v.getUint32(4, true),
    buttons: v.getUint32(8, true),
    modifiers: v.getUint32(12, true),
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
    key: keyFromMac(keyCode, chars),
    code,
    repeat: false,
  };
}

export function decodeQueuedEvents(buf: Uint8Array, count: number): NativeQueuedEvent[] {
  const out: NativeQueuedEvent[] = [];
  for (let i = 0; i < count; i++) {
    const offset = i * QUEUED_EVENT_BYTES;
    if (offset + QUEUED_EVENT_BYTES > buf.byteLength) break;
    out.push(decodeQueuedEvent(buf, offset));
  }
  return out;
}
