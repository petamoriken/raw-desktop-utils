import { inspectBranded, type InspectFn, kCustomInspect } from "../inspect.ts";
import { AudioParam } from "./param.ts";

export class AudioListener {
  readonly #brand = true;
  readonly positionX: AudioParam = new AudioParam({
    name: "positionX",
    defaultValue: 0,
    automationRate: "a-rate",
  });
  readonly positionY: AudioParam = new AudioParam({
    name: "positionY",
    defaultValue: 0,
    automationRate: "a-rate",
  });
  readonly positionZ: AudioParam = new AudioParam({
    name: "positionZ",
    defaultValue: 0,
    automationRate: "a-rate",
  });
  readonly forwardX: AudioParam = new AudioParam({
    name: "forwardX",
    defaultValue: 0,
    automationRate: "a-rate",
  });
  readonly forwardY: AudioParam = new AudioParam({
    name: "forwardY",
    defaultValue: 0,
    automationRate: "a-rate",
  });
  readonly forwardZ: AudioParam = new AudioParam({
    name: "forwardZ",
    defaultValue: -1,
    automationRate: "a-rate",
  });
  readonly upX: AudioParam = new AudioParam({
    name: "upX",
    defaultValue: 0,
    automationRate: "a-rate",
  });
  readonly upY: AudioParam = new AudioParam({
    name: "upY",
    defaultValue: 1,
    automationRate: "a-rate",
  });
  readonly upZ: AudioParam = new AudioParam({
    name: "upZ",
    defaultValue: 0,
    automationRate: "a-rate",
  });

  setPosition(x: number, y: number, z: number): void {
    this.positionX.value = x;
    this.positionY.value = y;
    this.positionZ.value = z;
  }

  setOrientation(
    x: number,
    y: number,
    z: number,
    xUp: number,
    yUp: number,
    zUp: number,
  ): void {
    this.forwardX.value = x;
    this.forwardY.value = y;
    this.forwardZ.value = z;
    this.upX.value = xUp;
    this.upY.value = yUp;
    this.upZ.value = zUp;
  }

  [kCustomInspect](inspect: InspectFn, options?: Deno.InspectOptions): string {
    return inspectBranded(
      #brand in this,
      "AudioListener",
      () => ({
        positionX: this.positionX.value,
        positionY: this.positionY.value,
        positionZ: this.positionZ.value,
      }),
      inspect,
      options,
    );
  }
}
