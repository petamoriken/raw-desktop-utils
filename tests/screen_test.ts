import { assertEquals, assertThrows } from "@std/assert";
import { createScreen, Screen } from "../src/screen.ts";

Deno.test("Screen constructor is illegal like the Web / Deno platform types", () => {
  const err = assertThrows(
    () => new Screen(),
    TypeError,
    "Illegal constructor",
  );
  assertEquals(err.name, "TypeError");
  assertThrows(() => new Screen({}), TypeError, "Illegal constructor");
});

Deno.test("Screen extends EventTarget and matches CSSOM View fields", () => {
  const screen = createScreen({
    width: 1920,
    height: 1080,
    availLeft: 0,
    availTop: 25,
    availWidth: 1920,
    availHeight: 1055,
  });
  assertEquals(screen instanceof EventTarget, true);
  assertEquals(screen.width, 1920);
  assertEquals(screen.height, 1080);
  assertEquals(screen.availLeft, 0);
  assertEquals(screen.availTop, 25);
  assertEquals(screen.availWidth, 1920);
  assertEquals(screen.availHeight, 1055);
  assertEquals(screen.colorDepth, 24);
  assertEquals(screen.pixelDepth, 24);
});

Deno.test("Screen.replace fires only through the caller and reports change", () => {
  const screen = createScreen({ width: 800, height: 600 });
  const seen: string[] = [];
  screen.addEventListener("change", () => seen.push("change"));
  assertEquals(
    screen.replace({
      width: 800,
      height: 600,
      availLeft: 0,
      availTop: 0,
      availWidth: 800,
      availHeight: 600,
    }),
    false,
  );
  assertEquals(
    screen.replace({
      width: 1920,
      height: 1080,
      availLeft: 0,
      availTop: 25,
      availWidth: 1920,
      availHeight: 1055,
    }),
    true,
  );
  assertEquals(screen.width, 1920);
  assertEquals(seen, []);
  screen.dispatchEvent(new Event("change"));
  assertEquals(seen, ["change"]);
});

Deno.test("inspecting Screen.prototype does not throw", () => {
  const text = Deno.inspect(Screen.prototype);
  assertEquals(text.includes("Screen"), true);
});

Deno.test("Deno.inspect hides Screen private fields", () => {
  const screen = createScreen({ width: 1024, height: 768 });
  const text = Deno.inspect(screen);
  assertEquals(text.includes("Screen"), true);
  assertEquals(text.includes("width: 1024"), true);
  assertEquals(text.includes("#"), false);
});
