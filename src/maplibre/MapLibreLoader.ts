import maplibregl from "maplibre-gl";
// Vite `?raw` import: inlines the CSS as a string so it can be injected into
// NyxmapCard's shadow root (a global <link> won't reach shadow DOM content).
import maplibreCss from "maplibre-gl/dist/maplibre-gl.css?raw";

export { maplibregl, maplibreCss };

/**
 * Advanced/dev-only fallback: load maplibre-gl from a CDN instead of using
 * the copy bundled into dist/nyxmap-card.js. NOT used by the default build —
 * HA custom cards ship as one drop-in resource file, and depending on a CDN
 * at runtime is a liability for self-hosted/air-gapped installs and version
 * drift (see CLAUDE.md's "MapLibre bundling" decision). Kept for callers that
 * deliberately want to swap the MapLibre version without rebuilding.
 */
let _cdnLoading: Promise<typeof maplibregl> | null = null;
export function loadMapLibreFromCdn(version = "4.7.1"): Promise<typeof maplibregl> {
  if (window.maplibregl) return Promise.resolve(window.maplibregl as typeof maplibregl);
  if (_cdnLoading) return _cdnLoading;
  _cdnLoading = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://unpkg.com/maplibre-gl@${version}/dist/maplibre-gl.css`;
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = `https://unpkg.com/maplibre-gl@${version}/dist/maplibre-gl.js`;
    script.onload = () => resolve(window.maplibregl as typeof maplibregl);
    script.onerror = () => reject(new Error("Failed to load maplibre-gl from CDN"));
    document.head.appendChild(script);
  });
  return _cdnLoading;
}

declare global {
  interface Window {
    maplibregl?: typeof maplibregl;
  }
}
