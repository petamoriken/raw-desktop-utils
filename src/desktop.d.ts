export {};

declare global {
  namespace Deno {
    class BrowserWindow extends EventTarget {
      constructor(options?: {
        title?: string;
        width?: number;
        height?: number;
        resizable?: boolean;
      });
      getNativeWindow(): UnsafeWindowSurface & {
        windowHandle?: Deno.PointerValue;
        displayHandle?: Deno.PointerValue;
      };
      getSize(): [number, number];
      readonly devicePixelRatio: number;
      close(): void;
      isClosed(): boolean;
    }
  }
}
