import { inspectBranded, type InspectFn, kCustomInspect } from "./inspect.ts";
import type { PointerType } from "./types.ts";

export type UIEventInit = EventInit & {
  view?: EventTarget | null;
  detail?: number;
};

export type MouseEventInit = UIEventInit & {
  screenX?: number;
  screenY?: number;
  clientX?: number;
  clientY?: number;
  offsetX?: number;
  offsetY?: number;
  pageX?: number;
  pageY?: number;
  movementX?: number;
  movementY?: number;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  /** `getModifierState("CapsLock")`. Not a standard `MouseEventInit` field. */
  capsLock?: boolean;
  button?: number;
  buttons?: number;
  relatedTarget?: EventTarget | null;
};

export type PointerEventInit = MouseEventInit & {
  pointerId?: number;
  width?: number;
  height?: number;
  pressure?: number;
  tangentialPressure?: number;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
  pointerType?: PointerType;
  isPrimary?: boolean;
};

export type WheelEventInit = MouseEventInit & {
  deltaX?: number;
  deltaY?: number;
  deltaZ?: number;
  deltaMode?: number;
};

export type KeyboardEventInit = UIEventInit & {
  key?: string;
  code?: string;
  location?: number;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  /** `getModifierState("CapsLock")`. Not a standard `KeyboardEventInit` field. */
  capsLock?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

export type CompositionEventInit = UIEventInit & {
  data?: string;
};

function modifierState(
  key: string,
  flags: {
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    capsLock: boolean;
  },
): boolean {
  switch (key) {
    case "Alt":
    case "AltGraph":
      return flags.altKey;
    case "Control":
      return flags.ctrlKey;
    case "Meta":
      return flags.metaKey;
    case "Shift":
      return flags.shiftKey;
    case "CapsLock":
      return flags.capsLock;
    case "Accel":
      return Deno.build.os === "darwin" ? flags.metaKey : flags.ctrlKey;
    default:
      return false;
  }
}

/**
 * UI Events `UIEvent` stand-in. Deno desktop raw mode has no DOM
 * `UIEvent` / `PointerEvent` constructors, so the library supplies them.
 */
export class UIEvent extends Event {
  readonly #view: EventTarget | null;
  readonly #detail: number;

  constructor(type: string, init: UIEventInit = {}) {
    super(type, init);
    this.#view = init.view ?? null;
    this.#detail = init.detail ?? 0;
  }

  get view(): EventTarget | null {
    return this.#view;
  }

  get detail(): number {
    return this.#detail;
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #view in this,
      "UIEvent",
      () => ({ type: this.type, view: this.#view, detail: this.#detail }),
      inspect,
      options,
    );
  }
}

export class MouseEvent extends UIEvent {
  readonly #screenX: number;
  readonly #screenY: number;
  readonly #clientX: number;
  readonly #clientY: number;
  readonly #offsetX: number;
  readonly #offsetY: number;
  readonly #pageX: number;
  readonly #pageY: number;
  readonly #movementX: number;
  readonly #movementY: number;
  readonly #ctrlKey: boolean;
  readonly #shiftKey: boolean;
  readonly #altKey: boolean;
  readonly #metaKey: boolean;
  readonly #capsLock: boolean;
  readonly #button: number;
  readonly #buttons: number;
  readonly #relatedTarget: EventTarget | null;

  constructor(type: string, init: MouseEventInit = {}) {
    super(type, init);
    this.#screenX = init.screenX ?? 0;
    this.#screenY = init.screenY ?? 0;
    this.#clientX = init.clientX ?? 0;
    this.#clientY = init.clientY ?? 0;
    this.#offsetX = init.offsetX ?? this.#clientX;
    this.#offsetY = init.offsetY ?? this.#clientY;
    this.#pageX = init.pageX ?? this.#clientX;
    this.#pageY = init.pageY ?? this.#clientY;
    this.#movementX = init.movementX ?? 0;
    this.#movementY = init.movementY ?? 0;
    this.#ctrlKey = init.ctrlKey ?? false;
    this.#shiftKey = init.shiftKey ?? false;
    this.#altKey = init.altKey ?? false;
    this.#metaKey = init.metaKey ?? false;
    this.#capsLock = init.capsLock ?? false;
    this.#button = init.button ?? 0;
    this.#buttons = init.buttons ?? 0;
    this.#relatedTarget = init.relatedTarget ?? null;
  }

  get screenX(): number {
    return this.#screenX;
  }
  get screenY(): number {
    return this.#screenY;
  }
  get clientX(): number {
    return this.#clientX;
  }
  get clientY(): number {
    return this.#clientY;
  }
  get offsetX(): number {
    return this.#offsetX;
  }
  get offsetY(): number {
    return this.#offsetY;
  }
  get pageX(): number {
    return this.#pageX;
  }
  get pageY(): number {
    return this.#pageY;
  }
  get movementX(): number {
    return this.#movementX;
  }
  get movementY(): number {
    return this.#movementY;
  }
  get ctrlKey(): boolean {
    return this.#ctrlKey;
  }
  get shiftKey(): boolean {
    return this.#shiftKey;
  }
  get altKey(): boolean {
    return this.#altKey;
  }
  get metaKey(): boolean {
    return this.#metaKey;
  }
  get button(): number {
    return this.#button;
  }
  get buttons(): number {
    return this.#buttons;
  }
  get relatedTarget(): EventTarget | null {
    return this.#relatedTarget;
  }

  getModifierState(key: string): boolean {
    return modifierState(key, {
      altKey: this.#altKey,
      ctrlKey: this.#ctrlKey,
      metaKey: this.#metaKey,
      shiftKey: this.#shiftKey,
      capsLock: this.#capsLock,
    });
  }

  override [kCustomInspect](
    inspect: InspectFn,
    options?: Deno.InspectOptions,
  ): string {
    return inspectBranded(
      #clientX in this,
      "MouseEvent",
      () => ({
        type: this.type,
        clientX: this.#clientX,
        clientY: this.#clientY,
        screenX: this.#screenX,
        screenY: this.#screenY,
        button: this.#button,
        buttons: this.#buttons,
        movementX: this.#movementX,
        movementY: this.#movementY,
        ctrlKey: this.#ctrlKey,
        shiftKey: this.#shiftKey,
        altKey: this.#altKey,
        metaKey: this.#metaKey,
        detail: this.detail,
      }),
      inspect,
      options,
    );
  }
}

export class PointerEvent extends MouseEvent {
  readonly #pointerId: number;
  readonly #width: number;
  readonly #height: number;
  readonly #pressure: number;
  readonly #tangentialPressure: number;
  readonly #tiltX: number;
  readonly #tiltY: number;
  readonly #twist: number;
  readonly #altitudeAngle: number;
  readonly #azimuthAngle: number;
  readonly #pointerType: PointerType;
  readonly #isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.#pointerId = init.pointerId ?? 1;
    this.#width = init.width ?? 1;
    this.#height = init.height ?? 1;
    this.#pressure = init.pressure ?? 0;
    this.#tangentialPressure = init.tangentialPressure ?? 0;
    this.#tiltX = init.tiltX ?? 0;
    this.#tiltY = init.tiltY ?? 0;
    this.#twist = init.twist ?? 0;
    this.#altitudeAngle = init.altitudeAngle ?? Math.PI / 2;
    this.#azimuthAngle = init.azimuthAngle ?? 0;
    this.#pointerType = init.pointerType ?? "mouse";
    this.#isPrimary = init.isPrimary ?? true;
  }

  get pointerId(): number {
    return this.#pointerId;
  }
  get width(): number {
    return this.#width;
  }
  get height(): number {
    return this.#height;
  }
  get pressure(): number {
    return this.#pressure;
  }
  get tangentialPressure(): number {
    return this.#tangentialPressure;
  }
  get tiltX(): number {
    return this.#tiltX;
  }
  get tiltY(): number {
    return this.#tiltY;
  }
  get twist(): number {
    return this.#twist;
  }
  get altitudeAngle(): number {
    return this.#altitudeAngle;
  }
  get azimuthAngle(): number {
    return this.#azimuthAngle;
  }
  get pointerType(): PointerType {
    return this.#pointerType;
  }
  get isPrimary(): boolean {
    return this.#isPrimary;
  }

  getCoalescedEvents(): PointerEvent[] {
    return [];
  }

  getPredictedEvents(): PointerEvent[] {
    return [];
  }

  override [kCustomInspect](
    inspect: InspectFn,
    options?: Deno.InspectOptions,
  ): string {
    return inspectBranded(
      #pointerId in this,
      "PointerEvent",
      () => ({
        type: this.type,
        pointerId: this.#pointerId,
        pointerType: this.#pointerType,
        isPrimary: this.#isPrimary,
        clientX: this.clientX,
        clientY: this.clientY,
        button: this.button,
        buttons: this.buttons,
        pressure: this.#pressure,
        tiltX: this.#tiltX,
        tiltY: this.#tiltY,
        twist: this.#twist,
        movementX: this.movementX,
        movementY: this.movementY,
      }),
      inspect,
      options,
    );
  }
}

export class WheelEvent extends MouseEvent {
  readonly #deltaX: number;
  readonly #deltaY: number;
  readonly #deltaZ: number;
  readonly #deltaMode: number;

  constructor(type: string, init: WheelEventInit = {}) {
    super(type, { ...init, button: init.button ?? 0 });
    this.#deltaX = init.deltaX ?? 0;
    this.#deltaY = init.deltaY ?? 0;
    this.#deltaZ = init.deltaZ ?? 0;
    this.#deltaMode = init.deltaMode ?? 0;
  }

  get deltaX(): number {
    return this.#deltaX;
  }
  get deltaY(): number {
    return this.#deltaY;
  }
  get deltaZ(): number {
    return this.#deltaZ;
  }
  get deltaMode(): number {
    return this.#deltaMode;
  }

  static readonly DOM_DELTA_PIXEL = 0;
  static readonly DOM_DELTA_LINE = 1;
  static readonly DOM_DELTA_PAGE = 2;

  override [kCustomInspect](
    inspect: InspectFn,
    options?: Deno.InspectOptions,
  ): string {
    return inspectBranded(
      #deltaX in this,
      "WheelEvent",
      () => ({
        type: this.type,
        clientX: this.clientX,
        clientY: this.clientY,
        deltaX: this.#deltaX,
        deltaY: this.#deltaY,
        deltaZ: this.#deltaZ,
        deltaMode: this.#deltaMode,
        ctrlKey: this.ctrlKey,
        shiftKey: this.shiftKey,
        altKey: this.altKey,
        metaKey: this.metaKey,
      }),
      inspect,
      options,
    );
  }
}

export class KeyboardEvent extends UIEvent {
  readonly #key: string;
  readonly #code: string;
  readonly #location: number;
  readonly #ctrlKey: boolean;
  readonly #shiftKey: boolean;
  readonly #altKey: boolean;
  readonly #metaKey: boolean;
  readonly #capsLock: boolean;
  readonly #repeat: boolean;
  readonly #isComposing: boolean;
  readonly #keyCode: number;

  constructor(type: string, init: KeyboardEventInit = {}) {
    super(type, init);
    this.#key = init.key ?? "";
    this.#code = init.code ?? "";
    this.#location = init.location ?? 0;
    this.#ctrlKey = init.ctrlKey ?? false;
    this.#shiftKey = init.shiftKey ?? false;
    this.#altKey = init.altKey ?? false;
    this.#metaKey = init.metaKey ?? false;
    this.#capsLock = init.capsLock ?? false;
    this.#repeat = init.repeat ?? false;
    this.#isComposing = init.isComposing ?? false;
    this.#keyCode = init.keyCode ?? 0;
  }

  get key(): string {
    return this.#key;
  }
  get code(): string {
    return this.#code;
  }
  get location(): number {
    return this.#location;
  }
  get ctrlKey(): boolean {
    return this.#ctrlKey;
  }
  get shiftKey(): boolean {
    return this.#shiftKey;
  }
  get altKey(): boolean {
    return this.#altKey;
  }
  get metaKey(): boolean {
    return this.#metaKey;
  }
  get repeat(): boolean {
    return this.#repeat;
  }
  get isComposing(): boolean {
    return this.#isComposing;
  }
  get keyCode(): number {
    return this.#keyCode;
  }

  getModifierState(key: string): boolean {
    return modifierState(key, {
      altKey: this.#altKey,
      ctrlKey: this.#ctrlKey,
      metaKey: this.#metaKey,
      shiftKey: this.#shiftKey,
      capsLock: this.#capsLock,
    });
  }

  static readonly DOM_KEY_LOCATION_STANDARD = 0;
  static readonly DOM_KEY_LOCATION_LEFT = 1;
  static readonly DOM_KEY_LOCATION_RIGHT = 2;
  static readonly DOM_KEY_LOCATION_NUMPAD = 3;

  override [kCustomInspect](
    inspect: InspectFn,
    options?: Deno.InspectOptions,
  ): string {
    return inspectBranded(
      #key in this,
      "KeyboardEvent",
      () => ({
        type: this.type,
        key: this.#key,
        code: this.#code,
        keyCode: this.#keyCode,
        location: this.#location,
        repeat: this.#repeat,
        isComposing: this.#isComposing,
        ctrlKey: this.#ctrlKey,
        shiftKey: this.#shiftKey,
        altKey: this.#altKey,
        metaKey: this.#metaKey,
      }),
      inspect,
      options,
    );
  }
}

export class CompositionEvent extends UIEvent {
  readonly #data: string;

  constructor(type: string, init: CompositionEventInit = {}) {
    super(type, init);
    this.#data = init.data ?? "";
  }

  get data(): string {
    return this.#data;
  }

  override [kCustomInspect](
    inspect: InspectFn,
    options?: Deno.InspectOptions,
  ): string {
    return inspectBranded(
      #data in this,
      "CompositionEvent",
      () => ({ type: this.type, data: this.#data }),
      inspect,
      options,
    );
  }
}

export type SynthesizedEvent =
  | PointerEvent
  | MouseEvent
  | WheelEvent
  | KeyboardEvent
  | CompositionEvent;

/** Rebuild an event so it can be dispatched to a second target. */
export function cloneSynthesized(event: SynthesizedEvent): SynthesizedEvent {
  if (event instanceof PointerEvent) {
    return new PointerEvent(event.type, copyPointer(event));
  }
  if (event instanceof WheelEvent) {
    return new WheelEvent(event.type, {
      ...copyMouse(event),
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
    });
  }
  if (event instanceof CompositionEvent) {
    return new CompositionEvent(event.type, {
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      view: event.view,
      detail: event.detail,
      data: event.data,
    });
  }
  if (event instanceof KeyboardEvent) {
    return new KeyboardEvent(event.type, {
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      view: event.view,
      detail: event.detail,
      key: event.key,
      code: event.code,
      location: event.location,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      capsLock: event.getModifierState("CapsLock"),
      repeat: event.repeat,
      isComposing: event.isComposing,
      keyCode: event.keyCode,
    });
  }
  return new MouseEvent(event.type, copyMouse(event));
}

function copyMouse(event: MouseEvent): MouseEventInit {
  return {
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    view: event.view,
    detail: event.detail,
    screenX: event.screenX,
    screenY: event.screenY,
    clientX: event.clientX,
    clientY: event.clientY,
    offsetX: event.offsetX,
    offsetY: event.offsetY,
    pageX: event.pageX,
    pageY: event.pageY,
    movementX: event.movementX,
    movementY: event.movementY,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    capsLock: event.getModifierState("CapsLock"),
    button: event.button,
    buttons: event.buttons,
    relatedTarget: event.relatedTarget,
  };
}

function copyPointer(event: PointerEvent): PointerEventInit {
  return {
    ...copyMouse(event),
    pointerId: event.pointerId,
    width: event.width,
    height: event.height,
    pressure: event.pressure,
    tangentialPressure: event.tangentialPressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    twist: event.twist,
    altitudeAngle: event.altitudeAngle,
    azimuthAngle: event.azimuthAngle,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
  };
}
