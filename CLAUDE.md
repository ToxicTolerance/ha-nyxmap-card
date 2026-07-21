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

Any new overlay type that uses MapLibre sources/layers rather than HTML markers needs to plug into
this same re-attach path, or it will silently vanish on the next theme change. `CircleRenderService`
(GPS-accuracy/radius circles) and `HistoryRenderService` (trail `LineString`s) follow it as
examples. Note `ClusterRenderService` deliberately does *not*: its cluster bubbles are HTML
`maplibregl.Marker`s (like entity markers), so they survive `setStyle()` for free and need no
re-attach registration — that's also what lets them animate via CSS transitions.

Per-entity accuracy circles (`CircleConfig`/`CircleRenderService`) render automatically for any
entity with a `gps_accuracy` or `radius` attribute — matching HA's own built-in map — controlled by
the card-level `show_accuracy_circles` (default `true`) and an entity's own `circle: false` opt-out;
an explicit per-entity `circle:` config always overrides both.

Marker clustering (`ClusterRenderService`) groups entities whose on-screen marker circles overlap
(screen-space collision via `map.project()`, union-find, recomputed on every camera move with
hysteresis), rendering each group as an animated HTML-marker bubble. Defaults on
(`cluster_markers`, matching HA's built-in map); `cluster_max_zoom` caps the zoom above which it
stops. Individual-marker hide/show and bubble merge/split share the `MarkerAnimator` CSS-transition
helper, and both marker kinds go through `wrapAnimatedMarker()` so their scale animation doesn't
fight MapLibre's own positioning transform.

### Visual config editor

`NyxmapCard.getConfigElement()`/`getStubConfig()` hand off to
`NyxmapCardEditor` (`nyxmap-card-editor`), which renders Home Assistant's own
globally-registered `<ha-form>` element against a declarative schema rather
than any bundled form library — `ha-form`/`ha-selector` are provided by the
surrounding HA frontend at runtime, never a project dependency. `src/editor/`
holds the schema/data-mapping logic as pure, DOM-free functions
(`build*Schema`, `*ToFormData`/`formDataTo*`) so they're unit-testable under
vitest's default `"node"` environment instead of needing jsdom.
`src/types/ha-form.d.ts` duck-types just the slice of `ha-form`'s contract
this repo binds to, mirroring the existing `home-assistant.d.ts` precedent.
`NyxmapFormListEditor` (`nyxmap-form-list-editor`) is a generic, schema-driven
array editor reused for both the entities list and `map_styles`, emitting a
bubbling `items-changed` event; `NyxmapCardEditor` merges those back into the
full config and re-dispatches a single `config-changed` event, always
preserving `type` and any out-of-scope keys (`geojson`, `tile_layers`, `wms` —
not covered by the visual editor; users drop to HA's "Edit in YAML" toggle for
those). The per-entity `circle:` key gets a simple on/off checkbox in the
entity form (`EntityFormSchema.ts`) — unchecking it writes `circle: false`;
checking it clears an explicit `false` back to unset (inheriting the
card-level default) while leaving any hand-authored `circle:` object
untouched, since the visual editor only covers the on/off case, not per-field
radius/color/fill_opacity editing.

### JS plugin hook (extension point)

`PluginHost` (`src/maplibre/PluginHost.ts`) turns the otherwise-private `maplibregl.Map` into a
documented extension point, so third-party MapLibre-ecosystem plugins can attach without forking
the card. It's built in `_buildMap()` (gated by the `plugins` config, default on) and its setup
pass runs **once** from the first `"style.load"` handler, right after `_reattach.replayAll` — so a
plugin's `registerOverlay` can `addSource`/`addLayer` immediately against a loaded style.

Plugins register two ways, both handed the same `NyxmapPluginContext` (public contract in
`src/types/nyxmap-plugin.d.ts`, the plugin-author surface — same duck-typing precedent as
`home-assistant.d.ts`): the `window.nyxmapPlugins` global array (mirrors HA's `window.customCards`)
and a bubbling/composed `nyxmap-map-ready` `CustomEvent` on the card element. Each `setup(ctx)` runs
in try/catch so a throwing plugin can't take the card down.

The context's helpers reuse existing machinery rather than new paths:
- `registerOverlay(id, {label, source, layers})` is a direct generalization of
  `GeoJsonRenderService._upsert`'s trio — `addSource`/`addLayer` **+** `StyleReattach.register`
  (survives theme swaps) **+** `LayerRegistry.registerOverlay` (appears in the layer switcher).
- `registerControl(control, position?)` is a thin `map.addControl` wrapper (controls are DOM, so
  they survive `setStyle` for free, like cluster bubbles).
- `injectStyle(cssOrUrl)` puts a plugin's stylesheet **inside the card's shadow root** — the load-
  bearing non-obvious bit: the card renders in a shadow root, so a plugin that ships its own CSS
  (compass/minimap/geocoder) attaches but renders **invisibly** (0×0) unless its CSS is injected
  here. URL → `<link>` (works in a shadow root, no CORS fetch); raw CSS → `<style>`; deduped.

Protocols / custom source types aren't first-class — authors reach for `ctx.maplibregl.addProtocol`
directly (the whole point of exposing the *bundled* `maplibregl`: bundling otherwise isolates it
from an external plugin script).

### Map control layout

MapLibre's `NavigationControl` (zoom/compass) and the two `IconButtonControl`s (Reset focus /
Toggle grouping) stack in the **top-right** as a single `.maplibregl-ctrl-group` column; the
`LayerSwitcherControl` toggle sits **beneath** that column, in the same corner. It's not a MapLibre
control (it's a template-placed Lit element), so it can't auto-stack — instead `_measure()` reads
the top-right column's rendered bottom/right edges and sets the toggle's `top`/`right` inline. This
tracks the column's *real* height, which changes because the Toggle grouping button is only present
when clustering is on (so a fixed offset would be wrong half the time). `IconButtonControl` draws
its glyph as **inline SVG** (not `<ha-icon>`) so the buttons render in the dev harness and anywhere
HA's `ha-icon` isn't registered — same rationale as `LayerSwitcherControl`'s inline layers icon.
The compact attribution is force-collapsed on the map's `idle` event (`_collapseAttribution`);
MapLibre re-expands it when a style's attribution text loads *after* `style.load`, so collapsing
only there wouldn't stick.

### Not yet ported (tracked against upstream `ha-map-card` feature parity)

Listed at the bottom of `maplibre-map-card.js` as the porting backlog — check there before
assuming a feature is unsupported vs. simply not yet implemented:

- `tile_layers` / WMS → MapLibre raster source (`{ type: 'raster', tiles: [...] }`)
- `geojson:` attribute → `map.addSource({ type: 'geojson' })` directly (native support, should be
  straightforward)
- `history_date_selection` → subscribe to `energy-date-selection`, as upstream does

(Upstream's Leaflet `plugins: []` is intentionally *not* mirrored — MapLibre has no plugin
registry to map it onto. It's superseded by nyxmap's own JS plugin hook; see "JS plugin hook"
above.)
