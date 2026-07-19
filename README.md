# NyxMap Card

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![HACS Custom Repository](https://img.shields.io/badge/HACS-custom--repository-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories/)
[![Release](https://img.shields.io/github/v/release/ToxicTolerance/ha-nyxmap-card)](https://github.com/ToxicTolerance/ha-nyxmap-card/releases)

A Home Assistant Lovelace map card rendered with **[MapLibre GL](https://maplibre.org/)**
(vector tiles, GPU-accelerated) instead of Leaflet. Forked in spirit from
[nathan-gs/ha-map-card](https://github.com/nathan-gs/ha-map-card) — the YAML
config surface stays close to upstream so existing dashboards migrate with
minimal changes, while the entire draw layer is swapped from Leaflet to
MapLibre GL: smooth vector styles, a 3D globe projection, and native
GeoJSON/geometry rendering.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration reference](#configuration-reference)
  - [Card options](#card-options)
  - [Entity options](#entity-options)
  - [Circle options](#circle-options-per-entity-circle)
  - [GeoJSON options](#geojson-options-per-entity-geojson)
  - [Tile/WMS layer options](#tilewms-layer-options-tile_layers--wms)
- [Examples](#examples)
- [Development](#development)
- [Roadmap](#roadmap)

## Features

- 🗺️ Vector map styles (any [MapLibre style JSON](https://maplibre.org/maplibre-style-spec/)),
  with separate light/dark styles that follow Home Assistant's theme automatically
- 🌐 3D globe projection (default) or classic flat mercator
- 📍 Entity markers with a picture → icon → initials fallback chain, tap to open more-info
- 📈 Per-entity history trails, rendered as a live GeoJSON line and kept correct across theme
  swaps
- 🎯 Initial camera framing via `focus_entity`/`focus_follow`, or auto-fit to every entity
- 🧭 An optional layer switcher panel — toggle between base map styles and show/hide overlays
  (history trails, circles, GeoJSON shapes) independently
- ⭕ Per-entity circles sized from `gps_accuracy`, a state attribute, or a fixed radius
- 🧩 Native GeoJSON rendering from any entity attribute (points, lines, polygons)
- 🛰️ Raster tile and WMS overlays (e.g. weather radar) layered on top of the vector base style,
  with `{{ states('entity_id') }}` URL templating

See [Roadmap](#roadmap) for what's not built yet.

## Installation

### HACS (recommended)

1. HACS → Frontend → ⋮ menu → **Custom repositories**
2. Add `https://github.com/ToxicTolerance/ha-nyxmap-card`, category **Plugin**
3. Install **NyxMap Card** — HACS registers the Lovelace resource for you
4. Add a card with `type: custom:nyxmap-card`

### Manual

1. Download `nyxmap-card.js` from the [latest release](https://github.com/ToxicTolerance/ha-nyxmap-card/releases/latest)
2. Copy it to `/config/www/nyxmap-card.js`
3. Add it as a Lovelace resource: **Settings → Dashboards → ⋮ → Resources**, URL
   `/local/nyxmap-card.js`, type **JavaScript Module**
4. Add a card with `type: custom:nyxmap-card`

## Quick start

```yaml
type: custom:nyxmap-card
title: Family Map
zoom: 12
focus_entity: person.alice
focus_follow: contains
entities:
  - person.alice
  - person.bob
  - entity: device_tracker.alice_phone
    history_start: 6 hours ago
    history_line_color: '#4287f5'
```

That's every option most dashboards need: pick who to show, where to start
framed, and optionally trail their recent history.

### Visual editor

Open **Edit card** on a NyxMap card and you'll get a visual form instead of
raw YAML: every [card option](#card-options) above, plus a full entities list
(add/remove/reorder, and every field in [Entity options](#entity-options)).
`circle`, `geojson`, `tile_layers`, and `wms` aren't in the visual editor yet —
switch to **Edit in YAML** (the toggle in the same dialog) to set those.

## Configuration reference

### Card options

| Option | Type | Default | Description |
|---|---|---|---|
| `x` / `y` | number | — | Explicit initial center as `x` (longitude) / `y` (latitude). Takes priority over `focus_entity`. |
| `zoom` | number | `12` | Initial zoom level. |
| `max_zoom` / `min_zoom` | number | MapLibre's own defaults (0–22) | Caps how far the camera can zoom. Set `max_zoom` if a raster `tile_layers`/`wms` overlay (or the base style itself) doesn't have imagery past a certain level, so zooming in stops at the last real tiles instead of going blank. |
| `title` | string | — | Card header text. |
| `card_size` | number | `5` | Used by Home Assistant's masonry layout when `height` isn't set (1 unit ≈ 50px). |
| `height` | number or CSS length string | auto from `card_size` | A number is pixels. A string (e.g. `"100%"`, `"50vh"`) is used verbatim — mainly for a [Panel view](https://www.home-assistant.io/dashboards/panel/), where `"100%"` fills the whole viewport exactly instead of leaving a gap or causing page scroll. |
| `theme_mode` | `auto` \| `light` \| `dark` | `auto` | `auto` follows the browser's `prefers-color-scheme`. |
| `map_style` | string (style JSON URL) | a free [OpenFreeMap](https://openfreemap.org/) style | Light-mode base style. |
| `map_style_dark` | string (style JSON URL) | a free [CARTO](https://carto.com/basemaps) dark style | Dark-mode base style. |
| `map_styles` | list of `{name, map_style, map_style_dark}` | — | Named base styles offered in the [layer switcher](#layer_switcher). Once this is set, the switcher shows only these — the generic "Light"/"Dark" options are hidden, since they'd otherwise duplicate/conflict with your own named entries. `map_style`/`map_style_dark` still drive the initial theme-follow behavior either way. |
| `projection` | `globe` \| `mercator` | `globe` | MapLibre's 3D globe view, or the classic flat projection. |
| `focus_entity` | entity id | — | Initial center, used when `x`/`y` aren't set. |
| `focus_follow` | `none` \| `refocus` \| `contains` | `none` | `refocus` re-centers on every update; `contains` only re-fits when `focus_entity` leaves the current view. |
| `layer_switcher` | boolean | `false` | Show a panel (top-right) for switching base styles and toggling overlays (history, circles, GeoJSON) on/off. |
| `history_start` / `history_end` | string (relative or ISO) | — | Card-level default history window, inherited by entities that don't set their own. |
| `tile_layers` | one or a list of [layer objects](#tilewms-layer-options-tile_layers--wms) | — | Raster tile overlay(s), layered on top of the vector base style. |
| `wms` | one or a list of [layer objects](#tilewms-layer-options-tile_layers--wms) | — | WMS overlay(s). |
| `entities` | list of entity ids or [entity objects](#entity-options) | `[]` | Entities to render. |

### Entity options

Each item in `entities:` is either a bare entity id string, or an object:

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | entity id | *required* | |
| `display` | `marker` \| `icon` | `marker` | `icon` skips the entity picture even if one is set. |
| `picture` | string (URL) | entity's `entity_picture` attribute | |
| `icon` | string (mdi icon) | entity's `icon` attribute | Used when there's no picture. |
| `label` | string | entity name initials | Used when there's neither picture nor icon. |
| `color` | string (CSS color) | derived from the entity id | Marker color, and the default color for that entity's circle/history trail/geojson shape. |
| `size` | number | `48` | Marker size in pixels. |
| `fixed_x` / `fixed_y` | number | — | Pin the marker to a fixed longitude/latitude instead of reading `latitude`/`longitude` attributes. |
| `focus_on_fit` | boolean | `true` | Whether this entity counts toward auto-fit-all-entities framing. |
| `history_start` / `history_end` | string | card-level default | Per-entity history window. Set `history_start` to enable a trail. |
| `history_line_color` | string | this entity's `color` | |
| `circle` | `"auto"` or [object](#circle-options-per-entity-circle) | — | |
| `geojson` | string (attribute name) or [object](#geojson-options-per-entity-geojson) | — | |

### Circle options (per-entity `circle:`)

Draws a circle around the entity — handy for showing GPS accuracy or a
geofence radius.

```yaml
entities:
  - entity: device_tracker.alice_phone
    circle: auto   # shorthand — same as { source: auto }
```

| Option | Type | Default | Description |
|---|---|---|---|
| `source` | `auto` \| `config` \| `attribute` \| `gps_accuracy` \| `radius` | `auto` (or `attribute` if `attribute` is set) | Where the radius comes from. `auto` prefers the `gps_accuracy` attribute, then a `radius` attribute, then falls back to `radius` below. |
| `attribute` | string | — | State attribute holding the radius (meters), used when `source: attribute`. |
| `radius` | number (meters) | `0` | Fixed radius, used when `source: config`, or as `auto`'s last resort. |
| `color` | string (CSS color) | entity's `color` | |
| `fill_opacity` | number | `0.1` | |

### GeoJSON options (per-entity `geojson:`)

Renders a GeoJSON geometry straight from an entity attribute — points, lines,
and polygons are all dispatched to the right layer type automatically.

```yaml
entities:
  - entity: geo_location.storm_cell
    geojson: geo_shape   # shorthand — same as { attribute: geo_shape }
```

| Option | Type | Default | Description |
|---|---|---|---|
| `attribute` | string | `geo_location` | State attribute holding the geometry — either a GeoJSON object or a JSON string. |
| `color` | string (CSS color) | entity's `color` | |
| `weight` | number | `3` | Line/outline width in pixels. |
| `opacity` | number | `1.0` | Line/outline opacity. |
| `fill_opacity` | number | `0.2` | Polygon fill opacity. |
| `hide_marker` | boolean | `false` | Hide this entity's own marker so only the shape shows. |

### Tile/WMS layer options (`tile_layers:` / `wms:`)

Card-level (not per-entity) raster overlays, layered on top of the vector
base style. Each entry:

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | string | *required* | For `tile_layers`, an XYZ template (`{z}/{x}/{y}`). For `wms`, the bare service endpoint — no query string. Supports `{{ states('entity_id') }}` templating, re-resolved live as that entity's state changes. |
| `options` | object | `{}` | For `tile_layers`, passed straight through as extra raster-source fields — including `minzoom`/`maxzoom`, if this layer's provider doesn't have imagery past a certain level. For `wms`, WMS GetMap params: `layers`, `format` (default `image/png`), `transparent` (default `true`), `version` (default `1.1.1`), `styles` (`minzoom`/`maxzoom` work here too). |
| `attribution` | string | — | Shown in the map's attribution control. |

```yaml
tile_layers:
  url: https://tile.openstreetmap.org/{z}/{x}/{y}.png
  options:
    attribution: '&copy; OpenStreetMap contributors'
wms:
  - url: https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi
    options:
      layers: nexrad-n0r
```

WMS requests are built as a MapLibre raster tile-URL template around its
`{bbox-epsg-3857}` substitution token — not hand-rolled BBOX math — so tiles
load exactly like any other raster source.

## Examples

<details>
<summary><strong>Custom map styles + layer switcher</strong></summary>

```yaml
type: custom:nyxmap-card
layer_switcher: true
map_style: https://tiles.openfreemap.org/styles/positron
map_style_dark: https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json
map_styles:
  - name: Satellite
    map_style: https://tiles.openfreemap.org/styles/liberty
entities:
  - person.alice
```

</details>

<details>
<summary><strong>GPS accuracy circle + history trail</strong></summary>

```yaml
type: custom:nyxmap-card
entities:
  - entity: device_tracker.alice_phone
    circle: auto
    history_start: 12 hours ago
    history_line_color: '#4287f5'
```

</details>

<details>
<summary><strong>GeoJSON zone, marker hidden</strong></summary>

```yaml
type: custom:nyxmap-card
entities:
  - entity: geo_location.storm_cell
    geojson:
      attribute: geo_shape
      color: '#e91e63'
      fill_opacity: 0.35
      hide_marker: true
```

</details>

<details>
<summary><strong>Flat mercator projection, fixed height</strong></summary>

```yaml
type: custom:nyxmap-card
projection: mercator
height: 400
entities:
  - person.alice
```

</details>

<details>
<summary><strong>Weather radar (WMS) overlay</strong></summary>

```yaml
type: custom:nyxmap-card
layer_switcher: true
wms:
  - url: https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi
    options:
      layers: nexrad-n0r
    attribution: 'Iowa Environmental Mesonet'
entities:
  - person.alice
```

</details>

<details>
<summary><strong>Full-screen Panel view</strong></summary>

For a [Panel view](https://www.home-assistant.io/dashboards/panel/) (a
dashboard tab with a single card filling the whole screen), use a percentage
height so the map fills the viewport exactly instead of leaving a gap or
causing the page to scroll:

```yaml
type: custom:nyxmap-card
height: 100%
entities:
  - person.alice
```

</details>

## Development

No Home Assistant instance required for day-to-day iteration — `npm run dev`
serves a local harness with a mocked `hass` object.

```
npm install
npm run dev          # Vite dev server against dev/harness.html
npm run build         # bundles dist/nyxmap-card.js (single ES module)
npm test               # vitest
npm run lint            # eslint
npm run typecheck       # tsc --noEmit
```

Releases are cut by pushing a `v*` tag — `.github/workflows/release.yml`
builds `dist/nyxmap-card.js`, attaches it to a GitHub Release, and pulls that
version's notes from [`CHANGELOG.md`](CHANGELOG.md); `filename` in
`hacs.json` points HACS at that release asset.

## Roadmap

Not yet built, tracked as upstream `ha-map-card` feature parity:

- Native marker clustering
- A plugin system
- Energy-dashboard date-range linking (`history_date_selection`)

See [`CLAUDE.md`](CLAUDE.md) for the full architecture notes and phased plan.
