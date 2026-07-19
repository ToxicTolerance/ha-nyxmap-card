// jsdom doesn't implement matchMedia (it requires layout/media-query
// support). Only NyxmapCard's theme_mode: "auto" resolution touches it, and
// only in the jsdom-environment test files — this stub keeps window defined
// in those files but is a no-op for the default "node" environment tests.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom doesn't implement ResizeObserver (it requires layout support). Only
// NyxmapCard's tab-switch resize workaround touches it, and only in the
// jsdom-environment test files — this no-op stub is enough since tests
// assert against map.resize() calls directly, not real layout changes.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// jsdom (25.x) does ship a requestAnimationFrame, but it's tied to its own
// internal frame-timing loop rather than firing on the next tick, so it
// doesn't resolve within a fast setTimeout(0)-based test flush — replaced
// unconditionally (not just when missing) with a plain setTimeout stand-in.
// Nothing here asserts on frame timing, only that the callback eventually
// runs.
if (typeof window !== "undefined") {
  window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number;
  window.cancelAnimationFrame = (handle: number): void => clearTimeout(handle);
}
