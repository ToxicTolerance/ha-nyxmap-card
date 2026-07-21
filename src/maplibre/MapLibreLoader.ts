import maplibregl from "maplibre-gl";
// Vite `?raw` import: inlines the CSS as a string so it can be injected into
// NyxmapCard's shadow root (a global <link> won't reach shadow DOM content).
import maplibreCss from "maplibre-gl/dist/maplibre-gl.css?raw";

// MapLibre is bundled into dist/nyxmap-card.js rather than fetched at runtime:
// HA custom cards ship as one drop-in resource file, and a CDN dependency is a
// liability for self-hosted/air-gapped installs (see CLAUDE.md's "MapLibre
// bundling" decision). Plugins that need the instance get it via the plugin
// hook's `ctx.maplibregl`, which hands over this exact bundled copy.
export { maplibregl, maplibreCss };
