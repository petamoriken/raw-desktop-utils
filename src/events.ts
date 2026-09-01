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
  | CompositionEvent;

/** Clone so a second `EventTarget` can dispatch without sharing `target` / canceled. */
export function cloneSynthesized(event: SynthesizedEvent): SynthesizedEvent {
  if (event instanceof CompositionEvent) {
    return new CompositionEvent(event.type, {
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      view: event.view,
      detail: event.detail,
      data: event.data,
    });
  }
  return new PointerEvent(event.type, copyPointer(event));
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
