/** Types for `deno desktop` APIs that only exist in the desktop runtime. */
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
      getNativeWindow(): UnsafeWindowSurface;
      getSize(): [number, number];
      close(): void;
    }
  }
}
