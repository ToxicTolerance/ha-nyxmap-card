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

The card element is `<nyxmap-card>` (`type: custom:nyxmap-card`), a Lit 3 custom element built
from TypeScript sources in `src/` and shipped as a **single bundled ES module**,
`dist/nyxmap-card.js`.

### Toolchain

`package.json` (v0.10.0-rc.2) is the source of truth; all of these scripts exist and work:

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server; `vite.config.ts` opens `dev/harness.html` |
| `npm run build` | Vite lib build → `dist/nyxmap-card.js` (`build:watch` for the watch mode) |
| `npm test` | `vitest run` (`test:watch`, `test:coverage` for the variants) |
| `npm run lint` | `eslint . --max-warnings 0` — the whole project, matching what `tsconfig.json` type-checks (`src`, `test`, `dev`, `vite.config.ts`) |
| `npm run typecheck` | `tsc --noEmit` |

Vite 6 + vitest 2 + TypeScript 5.7 + eslint 9 (with `typescript-eslint` and `eslint-plugin-lit`).
`tsconfig.json` is `strict` **plus** `noUncheckedIndexedAccess`, `forceConsistentCasingInFileNames`
and `isolatedModules` — assume new code has to clear that bar. Runtime dependencies are just
`maplibre-gl`, `lit` and `@turf/circle`. `.github/workflows/test.yml` runs typecheck → lint →
`test:coverage` → build on pushes to `main`/`master` and on every PR, and `release.yml` calls it as
a required job so a `v*` tag can't publish without passing it. Two deliberate sharp edges in that
gate: `lint` runs with `--max-warnings 0` (eslint exits 0 on warnings, so without it a lint job can
never fail — `no-unused-vars` and unused `eslint-disable` directives are both warn-severity here),
and `passWithNoTests` is off, so a glob mistake that collects zero tests fails instead of reporting
green. Coverage thresholds live in `vite.config.ts` and are **per-file** floors (70% of each metric,
`perFile: true`) rather than aggregate ones — an aggregate gate lets one module rot to 0% while the
rest of the tree carries the average. Actuals are far above the floor (~98% statements/lines, ~96%
functions, ~91% branches); `LayerSwitcherControl.ts` is the weakest file and sets the ceiling on how
high the floor can go.

### Dev loop

No Home Assistant instance is needed for day-to-day work: `npm run dev` serves `dev/harness.html`,
which mounts a real `<nyxmap-card>` against the mocked `hass` object in `dev/mock-hass.ts`
(`dev/main.ts` holds the harness config). `dev/plugin-example.html` / `dev/plugin-example.ts`
exercise the JS plugin hook the same way. To test inside a real HA instance instead, run
`npm run build` and copy `dist/nyxmap-card.js` to `/config/www/`, registering it as a Lovelace
resource of type "JavaScript Module".

### MapLibre bundling

MapLibre GL is **bundled into `dist/nyxmap-card.js`**, not loaded from a CDN at runtime: an HA
custom card ships as one drop-in resource file, and a runtime CDN dependency is a liability for
self-hosted/air-gapped installs and a source of version drift. `vite.config.ts` therefore uses a
lib build with `inlineDynamicImports: true` so the whole card — MapLibre included — is one ES
module (~1.7 MB raw / ~366 kB gzip; the size is essentially all `maplibre-gl` and is accepted
deliberately). `src/maplibre/MapLibreLoader.ts` re-exports that bundled `maplibregl` plus its CSS
(imported with Vite's `?raw` so it can be injected into the card's shadow root, where a global
`<link>` wouldn't reach). There is deliberately **no** runtime-CDN escape hatch — an unused
`loadMapLibreFromCdn()` existed until v0.10.0 and was removed as a version-skew trap (it defaulted
to a MapLibre major behind the bundled one). Plugins that need the instance get this same bundled
copy via the plugin hook's `ctx.maplibregl`.

`dist/` is gitignored and not tracked. `.github/workflows/release.yml` builds it on a `v*` tag and
attaches it to the GitHub Release; `hacs.json`'s `filename: nyxmap-card.js` points HACS at that
asset.

## Architecture

`src/` is split into directories that mirror where `ha-map-card`'s own modules live, which is
intentional — it keeps the fork diffable against the upstream project's module boundaries:

- **`src/index.ts`** — bundle entry. Imports the card element and registers it in
  `window.customCards` so HA's card picker lists it.
- **`src/components/`** — the Lit elements: `NyxmapCard` (the card itself and the largest module —
  lifecycle, map construction, service orchestration), `NyxmapCardEditor` + `NyxmapFormListEditor`
  (visual config editor), `LayerSwitcherControl`. Each has a sibling `*.styles.ts`.
- **`src/configs/`** — `MapConfig`, `EntityConfig`, `CircleConfig`, `GeoJsonConfig`, `LayerConfig`
  (+ `TileLayerConfig`/`WmsLayerConfig`) parse the Lovelace YAML into typed objects. See
  "Config surface" below for how keys relate to upstream.
- **`src/services/`** — `HaHistoryService` fetches entity position history via `hass.callWS` and
  returns `[[lng, lat], ...]` ready to drop into a GeoJSON `LineString`; `HaUrlResolveService`
  resolves `{{ states('entity_id') }}` templating in tile/WMS URLs. Both renderer-agnostic.
- **`src/services/render/`** — one service per render concern, each injected into `NyxmapCard` and
  each tested against a fake map: `EntitiesRenderService`, `HistoryRenderService`,
  `CircleRenderService`, `GeoJsonRenderService`, `TileLayersRenderService` (raster tile + WMS
  overlays), `ClusterRenderService`, `InitialViewRenderService`, plus `LayerRegistry` (the
  deliberately non-reactive registry backing the layer switcher).
- **`src/maplibre/`** — the MapLibre-facing seam: `MapLibreLoader` (bundled `maplibregl` + CSS),
  `MarkerFactory` (marker DOM: picture / icon / initials fallback chain, ported ~1:1 from
  `ha-map-card`'s divIcon logic), `MarkerAnimator`, `IconButtonControl`, `StyleReattach`,
  `PluginHost`.
- **`src/models/`** — `Circle`, `GeoJson`, `EntityHistory`/`EntityHistoryManager`.
- **`src/editor/`** — pure, DOM-free schema/mapping functions for the visual editor
  (`CardFormSchema`, `EntityFormSchema`, `MapStyleFormSchema`).
- **`src/util/`** — `HaMapUtilities` (time parsing, color helpers), `geo`.
- **`src/types/`** — `home-assistant.d.ts`, `ha-form.d.ts`, `nyxmap-plugin.d.ts`: duck-typed
  contracts for things provided by the surrounding HA frontend or consumed by plugin authors,
  never project dependencies.

### Tests

Tests are **colocated**: `Foo.ts` sits next to `Foo.test.ts` (33 test files today), and
`vite.config.ts` collects `src/**/*.test.ts`. The default environment is `node`; the ~10 files that
need a DOM opt in individually with a `// @vitest-environment jsdom` pragma rather than making
jsdom global. `test/setup.ts` shims `matchMedia`, `ResizeObserver` and `requestAnimationFrame` for
those, each with a comment explaining why. `test/fakes/FakeMaplibreMap.ts` is a hand-rolled double —
real MapLibre needs WebGL, which neither jsdom nor CI has — and is the seam every render service is
tested through. Prefer the `src/editor/` pattern where it fits: keep decision logic in pure
functions so it tests under `node` with no DOM at all.

### Config surface (relative to upstream `ha-map-card`)

Config keys are kept identical to `ha-map-card` wherever the concept still applies (`x`/`y`,
`zoom`, `title`, `card_size`, `focus_entity`, `focus_follow`, per-entity
`display`/`picture`/`icon`/`color`, `tile_layers`/`wms`, …), so existing dashboards migrate with
minimal changes. `README.md` is the user-facing reference for every key; the notes here are only
the places nyxmap deliberately diverges:

- **`map_style` / `map_style_dark`** replace upstream's `tile_layer_url`, because MapLibre consumes
  vector **style JSON URLs** rather than XYZ tile templates. Their defaults are free, keyless
  styles (OpenFreeMap light / CARTO dark) so a zero-config card renders on first run. *Open risk to
  flag:* those are third-party public endpoints with no SLA or rate-limit guarantee — fine as a
  default, worth documenting for anyone deploying widely.
- **`map_styles`** (named base-style entries for the layer switcher) and **`layer_switcher`** are
  not upstream keys at all — they exist because MapLibre can hot-swap whole styles, which Leaflet
  tile layers can't.
- **`projection`** is MapLibre-native (globe vs. mercator) and has no upstream counterpart. It
  **defaults to `globe`**: the 3D globe is the most visible thing MapLibre buys over Leaflet, and
  `projection: mercator` is a one-line opt-out for anyone who wants the classic flat view.
- **`plugins`** gates nyxmap's own JS plugin hook. Upstream's Leaflet `plugins: []` array is
  intentionally *not* mirrored — see "JS plugin hook" below.
- **`z_index_offset`** matches upstream but defaults to `1`, not `0`, and is applied to the
  marker's *positioning wrapper* — the outer node MapLibre transforms — rather than the marker DOM
  itself (`MarkerFactory.ts`, via `wrapAnimatedMarker`).

### The one non-obvious invariant: markers vs. sources across theme swaps

`_resolveStyle()` picks a light/dark MapLibre style JSON based on `theme_mode` (or system
preference when `auto`). Switching themes calls `map.setStyle(...)`, which **wipes all GeoJSON
sources/layers but does *not* remove HTML `Marker` elements** (they live outside the style).
Consequently:

- Entity markers are created once and just get their `LngLat` updated — they survive style swaps
  for free.
- Anything added as a source/layer must be re-added after every style load. That is what
  `StyleReattach` (`src/maplibre/StyleReattach.ts`) is for: a service calls
  `reattach.register(id, map => …)` with a factory that re-adds its own source/layers, and
  `NyxmapCard`'s `"style.load"` handler (in `_buildMap()`) calls `this._reattach.replayAll(this._map!)`
  — that handler fires both on first load and after every subsequent `setStyle()`. Four render
  services register today, each owning an id prefix: `HistoryRenderService` (`history-${entityId}`
  trail `LineString`s), `CircleRenderService` (`circle-…`), `GeoJsonRenderService` (`geojson-…`) and
  `TileLayersRenderService` (`tile-layer-…` / `wms-layer-…`), plus any plugin overlay registered
  through `PluginHost`'s `registerOverlay`.

Any new overlay type that uses MapLibre sources/layers rather than HTML markers needs to plug into
this same re-attach path, or it will silently vanish on the next theme change. `CircleRenderService`
(GPS-accuracy/radius circles) and `HistoryRenderService` (trail `LineString`s) are the smallest
examples to copy. Note `ClusterRenderService` deliberately does *not*: its cluster bubbles are HTML
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
and a bubbling/composed `nyxmap-map-ready` `CustomEvent` on the card element.

#### Fault isolation: "a misbehaving plugin can't take the card down"

Everything a plugin hands the card runs inside the map's `"style.load"` handler, which does the
rest of its work (tile layers, entities/clusters, geojson, history, initial view) *after* the
plugin pass. Four separate guards keep third-party code from reaching that work:

- **`setup(ctx)`** — each `window.nyxmapPlugins` entry is called in its own try/catch
  (`PluginHost.activate`), logging `console.error` and moving to the next plugin. The
  `nyxmap-map-ready` path isn't wrapped by us and doesn't need to be: an exception thrown by a DOM
  event listener is reported by the browser, not propagated back to `dispatchEvent`.
- **`registerControl`** — wraps `map.addControl` in try/catch, because `addControl` synchronously
  calls the control's `onAdd()`, which is third-party code at the same trust level as `setup`.
- **`StyleReattach.replayAll`** — replays each factory in its own try/catch, so one bad overlay
  (an invalid layer spec, a duplicate layer id) can't abort the remaining factories or the handler
  downstream. This is what makes the guarantee hold *past the first style load*: a plugin's failing
  `addSource`/`addLayer` is caught by `activate`'s try/catch on the first load, but its factory is
  registered by then, so without this every subsequent theme swap would wipe tile layers, circles,
  geojson and history. A throwing factory is deliberately **kept registered** (the usual cause is
  transient) and the error names its id. `replayAll` also snapshots the registry before iterating,
  so a factory that `register()`s mid-replay isn't visited in the same pass — otherwise a
  self-registering factory loops forever.
- **Overlay id collisions are rejected**, all-or-nothing, rather than half-registered — see below.

The context's helpers reuse existing machinery rather than new paths:
- `registerOverlay(id, {label, source, layers})` is a direct generalization of
  `GeoJsonRenderService._upsert`'s trio — `addSource`/`addLayer` **+** `StyleReattach.register`
  (survives theme swaps) **+** `LayerRegistry.registerOverlay` (appears in the layer switcher).
  Because those three registries are one flat string namespace shared with the card's own render
  services, an id is rejected (with a `console.warn` suggesting `plugin:<id>`) when it either
  already exists in `StyleReattach`/`LayerRegistry` **or** starts with one of the prefixes those
  services own — `history-`, `circle-`, `geojson-`, `tile-layer-`, `wms-layer-`
  (`RESERVED_OVERLAY_ID_PREFIXES`). Plugin authors must namespace around that list. The static
  prefixes are not redundant with the dynamic check: `activate()` runs *before* the render
  services' first `update()`, so at plugin-registration time a colliding id isn't in either
  registry yet and would pass a purely dynamic test, only to be clobbered moments later.
- `registerControl(control, position?)` is a thin, error-isolated `map.addControl` wrapper
  (controls are DOM, so they survive `setStyle` for free, like cluster bubbles).
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
Every card-added control therefore lives in the **top-right**; the only other occupied corner is
bottom-right, which holds MapLibre's own compact attribution. Nothing the card itself adds sits
bottom-left; an earlier layout put the layer switcher there, but no code or comment claims that any
more. (`bottom-left` still appears in `NyxmapCard.styles.ts`, in a margin rule that covers all four
`.maplibregl-ctrl-*` corners, and in the plugin examples, where the author picks that corner for
their own control — both correct.)
The compact attribution is force-collapsed on the map's `idle` event (`_collapseAttribution`);
MapLibre re-expands it when a style's attribution text loads *after* `style.load`, so collapsing
only there wouldn't stick.

## Porting backlog (not yet ported from upstream `ha-map-card`)

**This section is the backlog's home.** Check here before assuming a feature is unsupported
rather than simply not yet implemented. `README.md`'s Roadmap is the user-facing summary of the
same list — keep the two in sync.

- **`history_date_selection`** — subscribe to HA's `energy-date-selection` event, as upstream
  does, so a card's history window follows the energy dashboard's date range. Nothing in `src/`
  references `energy-date-selection` today.
- **WMS `history` sub-config** (the WMS `TIME` parameter). `LayerConfig` deliberately omits it
  because it's tightly coupled to the date-range linking above; it's deferred alongside it rather
  than half-wired.
- **Entity-valued `history_start`/`history_end`** — upstream lets these name an entity (e.g.
  `input_number.hours`, read as a number of hours). `HaMapUtilities.resolveTime()` handles relative
  ("5 hours ago") and absolute/ISO values, and deliberately returns `null` for an entity id,
  because resolving one needs a `hass` state lookup that `resolveTime` has no access to.

Already ported, despite older comments implying otherwise: `tile_layers`/WMS raster overlays
(`TileLayerConfig`/`WmsLayerConfig` → `TileLayersRenderService`) and per-entity `geojson:`
(`GeoJsonConfig` → `GeoJsonRenderService`). Both are documented with full config tables in
`README.md`.

Deliberately *not* ported: upstream's Leaflet `plugins: []` array — MapLibre has no plugin registry
to map it onto, and it's superseded by nyxmap's own JS plugin hook (see above).
