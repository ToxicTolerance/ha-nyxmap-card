# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Home Assistant Lovelace custom card that renders a map using **MapLibre GL** (vector tiles)
instead of Leaflet. It is forked in spirit from
[nathan-gs/ha-map-card](https://github.com/nathan-gs/ha-map-card) (MIT): the HA-facing plumbing
(YAML config surface, entity/history handling, card lifecycle) mirrors that project so existing
`ha-map-card` dashboards can migrate with minimal config changes. Only the draw layer is swapped
from Leaflet to MapLibre GL. Target: match `ha-map-card`'s feature set (overlays, map styles,
history trails, clustering, etc.) on top of MapLibre.

There is currently no build tooling, package manifest, or test suite in this repo — it is a
single-file custom element (`maplibre-map-card.js`) intended for drop-in use:

- **Dev**: copy the file to `/config/www/maplibre-map-card.js` in a Home Assistant instance and
  register it as a Lovelace dashboard resource of type "JavaScript Module".
- **Prod (planned)**: bundle MapLibre via its own Rollup config instead of pulling it from the
  `unpkg` CDN at runtime (see `loadMapLibre()`).

Since there's no build/lint/test setup yet, don't assume `npm run build`/`test` exist — check for
a `package.json` before referencing any command.

## Architecture

The file is organized into banner-delimited sections that map 1:1 to where `ha-map-card`'s own
modules would live, which is intentional — it keeps the fork diffable against the upstream
project's module boundaries:

- **`configs/MapConfig`** — `MapConfig` and `EntityConfig` parse the Lovelace YAML. Config keys
  are kept identical to `ha-map-card` wherever the concept still applies (`x`/`y`, `zoom`, `title`,
  `card_size`, `focus_entity`, `focus_follow`, per-entity `display`/`picture`/`icon`/`color`,
  etc.). The only new keys are `map_style` / `map_style_dark`, which replace `tile_layer_url`
  because MapLibre uses vector style JSON URLs rather than XYZ tile templates.
- **`services/HistoryService`** — fetches entity position history via `hass.callWS` and returns
  `[[lng, lat], ...]` ready to drop into a GeoJSON `LineString`. Renderer-agnostic, essentially
  unchanged from upstream.
- **`render/*`** — `buildMarkerElement` ports the marker DOM (picture / icon / initials fallback
  chain) almost 1:1 from `ha-map-card`'s divIcon logic, plus small helpers (`initials`,
  `colorFromString`) for the default marker look.
- **Card lifecycle** — `MapLibreMapCard extends HTMLElement` implements the standard HA custom
  card contract (`setConfig`, `set hass`, `getCardSize`).

### The one non-obvious invariant: markers vs. sources across theme swaps

`_resolveStyle()` picks a light/dark MapLibre style JSON based on `theme_mode` (or system
preference when `auto`). Switching themes calls `map.setStyle(...)`, which **wipes all GeoJSON
sources/layers but does *not* remove HTML `Marker` elements** (they live outside the style).
Consequently:

- Entity markers are created once and just get their `LngLat` updated — they survive style swaps
  for free.
- Anything added as a source/layer (currently: history-trail `LineString`s, keyed
  `history-${entityId}`) must be re-added after every style load. This is done in
  `_reattachSources()`, called from the `"style.load"` map event handler — that handler fires both
  on first load and after every subsequent `setStyle()`.

Any new overlay type (circles, clustering, raster tile layers, etc.) that uses MapLibre
sources/layers rather than HTML markers needs to plug into this same re-attach path, or it will
silently vanish on the next theme change.

### Not yet ported (tracked against upstream `ha-map-card` feature parity)

Listed at the bottom of `maplibre-map-card.js` as the porting backlog — check there before
assuming a feature is unsupported vs. simply not yet implemented:

- `tile_layers` / WMS → MapLibre raster source (`{ type: 'raster', tiles: [...] }`)
- `circle:` options → GeoJSON fill layer (turf.circle or geodesic polygon)
- `geojson:` attribute → `map.addSource({ type: 'geojson' })` directly (native support, should be
  straightforward)
- `cluster_markers` → source `cluster: true` + circle/symbol layers (**not** HTML markers — a
  different rendering path than the current marker system)
- `plugins: []` → Leaflet's plugin API doesn't map to MapLibre; needs a new hook design
- `history_date_selection` → subscribe to `energy-date-selection`, as upstream does
