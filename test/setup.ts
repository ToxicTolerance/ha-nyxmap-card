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
