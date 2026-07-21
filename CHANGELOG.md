# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.9.0] - 2026-07-21

### Added

- **JS plugin hook** — the card now hands third-party MapLibre plugins (and your
  own code) the live map and the exact bundled `maplibregl` module, so anything
  from the [MapLibre plugin ecosystem](https://maplibre.org/maplibre-gl-js/docs/plugins/)
  can attach without forking the card. Register plugins via the
  `window.nyxmapPlugins` global or the bubbling `nyxmap-map-ready` event; each
  plugin's `setup(ctx)` runs once per card. The context includes first-class
  helpers `registerOverlay(id, {label, source, layers, …})` (custom overlays
  that survive theme swaps and appear in the layer switcher),
  `registerControl(control, position?)` (IControl controls), and
  `injectStyle(cssOrUrl)` (place a plugin's own stylesheet inside the card's
  shadow root — required for visual plugins like a compass/minimap, which
  otherwise attach but render invisibly), plus `map`, `maplibregl`,
  `getHass()`/`getConfig()`, and a `reattach` escape hatch. A new
  `plugins: false` card option disables the hook entirely. A runnable demo
  lives at `dev/plugin-example.html`. See the README's "Plugins" section.

## [0.8.4] - 2026-07-21

### Fixed

- The MapLibre navigation control (zoom in/out and compass) now adapts to the
  Home Assistant theme: its background matches the card surface and, on a dark
  card background, its baked-in dark icons are inverted so they stay visible
  instead of vanishing.

## [0.8.3] - 2026-07-20

### Changed

- Layer switcher "Map type" options are now a uniform-width vertical list (icon
  left, label right) so every base-map card is the same size regardless of its
  name's length, instead of each card sizing to its label.

## [0.8.2] - 2026-07-20

### Changed

- Map control layout reworked: the "Reset focus" and "Toggle grouping" buttons
  now stack directly beneath the zoom/compass control (top-right), and the layer
  switcher moved to the bottom-left.
- The layer switcher is restyled after Google/Apple Maps' layer picker — a
  floating layers button that opens a card panel (opening upward) with the base
  map as selectable cards, the theme as a segmented control, and overlays as
  iOS-style toggle switches. It closes when you tap the map, and scrolls
  internally (with rounded corners preserved) when the map is too short to fit
  the whole panel.

## [0.8.1] - 2026-07-20

### Changed

- Cluster bubbles now use the active Home Assistant theme's accent
  (`--primary-color`) with a translucent halo ring, matching HA's own map
  cluster markers, instead of a fixed blue/yellow/red palette.

### Added

- The entity `color` and `history_line_color` fields in the visual editor are
  now proper color-wheel pickers (HA's `color_rgb` selector) instead of plain
  text boxes. Hex values round-trip through the picker; a non-hex value (e.g.
  `red` or an `rgb(...)` string) set via YAML is left untouched.

### Fixed

- Accuracy circles are now hidden for entities absorbed into a cluster bubble —
  previously a clustered entity's circle lingered at its real position under the
  bubble. They reappear when the cluster splits.
- Cluster merge/split animation is now smooth: grouping recomputes only when the
  camera settles (not on every move frame), so the spring plays against a static
  camera instead of a still-moving one — matching how HA animates its clusters.

## [0.8.0] - 2026-07-20

### Changed

- Marker clustering is now **touching-based**: entities collapse into a bubble
  only when their actual on-screen marker circles overlap (each marker is a
  circle of its configured `size`), instead of a fixed pixel radius bucketed per
  zoom level. Bubbles now animate with the same **positional spring** as Home
  Assistant's own built-in map (Leaflet): markers converge into the cluster
  centre as they merge and fly back out to their real positions when a cluster
  splits — but with the per-marker-size awareness HA's flat radius doesn't have.
- **`cluster_markers` now defaults to `true`** (was `false`), matching Home
  Assistant's built-in map. Dashboards that never set it will now cluster
  overlapping markers; set `cluster_markers: false` to opt out.

### Removed

- **Breaking:** `cluster_radius` (added in 0.7.7) is removed — clustering is now
  derived from each marker's real rendered size, so there is no pixel-radius
  constant to tune. `cluster_max_zoom` is unchanged and still caps the zoom
  above which clustering stops.

## [0.7.7] - 2026-07-20

### Added

- `cluster_markers` grouping is now tunable: new `cluster_radius` and
  `cluster_max_zoom` card options control how aggressively nearby entities
  collapse into a bubble. `cluster_radius` defaults to the largest configured
  entity `size` (48px if none set) instead of a flat 50 — since every marker
  renders as a circle exactly `size` px across, this approximates "cluster
  once markers would actually touch" out of the box. Both are exposed as
  fields in the visual editor's "Behavior" section, next to `cluster_markers`.

### Fixed

- Changing `cluster_radius`/`cluster_max_zoom` on an already-built map now
  actually takes effect — MapLibre bakes those options into the cluster
  source at creation time and ignores changes pushed through `setData()`, so
  the source is now torn down and recreated when either value changes.

## [0.7.6] - 2026-07-20

### Added

- Entities with a `gps_accuracy` or `radius` attribute now get an accuracy
  circle drawn around them automatically, matching Home Assistant's own
  built-in map — previously this required setting `circle: auto` by hand on
  every entity. Turn it off card-wide with `show_accuracy_circles: false`, or
  opt a single entity out with `circle: false`; an explicit per-entity
  `circle:` config still always takes precedence over either default.
- The per-entity `circle:` option now has a "Show accuracy circle" checkbox
  in the visual editor (previously YAML-only), and the new
  `show_accuracy_circles` card option is exposed as a "Behavior" toggle
  alongside `cluster_markers`.

## [0.7.5] - 2026-07-20

### Fixed

- `history_show_lines`, `history_show_dots`, and `cluster_markers` were
  added to `MapConfig` in 0.6.0 but never wired into the visual card
  editor's schema, so they were only settable via YAML despite being
  documented top-level options. They now appear as toggles in the
  editor's "Behavior" section.

## [0.7.4] - 2026-07-20

### Added

- A separate "Theme" (Auto/Light/Dark) control in the layer switcher,
  shown whenever `map_styles` is configured. Previously, once `map_styles`
  hid the generic "Light"/"Dark" base-style buttons (0.5.1), there was no
  live way to swap a named entry's own light/dark variant at all —
  `theme_mode` was config-only. Independent of which named style is
  active: picking a base style and picking its light/dark variant are two
  different questions, so a style no longer needs a redundant "hell"/
  "dunkel"-suffixed name pair to offer both.

### Fixed

- The visual card editor's live preview rendered a completely blank area
  for any card configured with a percentage/CSS-length `height` (e.g.
  `height: "100%"`, the common choice for a Panel view). `height: 100%`
  only resolves against an ancestor with a *specified* height — fine in a
  real Panel view, but HA's "Edit card" dialog gives its preview pane no
  explicit height (sizes to content instead), collapsing the whole chain
  (`:host` → `ha-card` → `.nyxmap-viewport`) to 0 with no error, just an
  empty area where the map should be. `.nyxmap-viewport` now has its own
  `min-height`, which flexbox distributes real space from regardless of
  whether the percentage chain above it ever resolves — confirmed via a
  reproduction mimicking the dialog's actual layout shape (auto-height
  content pane, no explicit ancestor height) before and after the fix.

## [0.7.3] - 2026-07-20

### Fixed

- Selecting a `map_styles` entry that was added or edited via a later
  config update (e.g. through the dashboard's visual editor, without a full
  page reload) silently fell back to the card-level `map_style`/
  `map_style_dark` instead of that entry's own light/dark pair —
  indistinguishable from "that style is broken" unless you knew to check
  for a stale switcher registry. The base-style registry was only ever
  populated once, inside `_buildMap()` (same root cause as the "Toggle
  grouping" button bug fixed in 0.7.2, just for `map_styles` entries this
  time). `setConfig()` now re-syncs it — registering new/changed entries
  and unregistering removed ones — on every config change, confirmed via
  the dev harness reproducing the exact "edit an already-built card"
  scenario before and after the fix.

## [0.7.2] - 2026-07-20

### Fixed

- "Toggle grouping" never appeared when `cluster_markers` was turned on via
  a later config edit (e.g. through the dashboard editor) rather than at
  the card's very first load — its presence was only ever decided once,
  inside `_buildMap()`, which never runs again for the lifetime of the card
  element. `setConfig()`/the `style.load` cycle now re-syncs the button's
  presence on every config change, so it reacts correctly whichever way
  `cluster_markers` gets flipped, without needing a full page reload.
- The new "Reset focus"/"Toggle grouping" buttons had poor contrast in a
  dark HA theme: MapLibre's own `.maplibregl-ctrl-group` hardcodes a white
  background regardless of theme, while the button icon's color followed
  HA's `--primary-text-color` (theme-aware) — in dark theme that paired a
  light icon with a background that never got any darker. The button
  container's background now themes together with the icon color (matching
  how the layer switcher's own toggle button already does), confirmed via
  the dev harness with simulated dark-theme CSS variables.

## [0.7.1] - 2026-07-20

### Fixed

- History trails could silently fail to render at all — and disappear from
  the layer switcher entirely — for a tracker whose state hadn't changed
  within the configured `history_start` window. `HaHistoryService.fetchPath`
  requested Home Assistant's history WS API with `minimal_response: true`,
  which only returns full attributes (including `latitude`/`longitude`) for
  the *first and last* row of the result; every row in between is stripped
  down to just `{last_changed, state}`. A tracker sitting in the same state
  the whole window could end up with 0-1 usable coordinate points, failing
  `EntityHistory.hasPath`'s "at least 2 points" check — which also gates
  registering the trail's layer-switcher overlay entry, so it vanished from
  both places at once. Now fetches with `minimal_response: false`, so every
  row's attributes are present.

## [0.7.0] - 2026-07-20

### Added

- "Reset focus" map button — always present, bottom-left corner. Re-runs the
  same initial-view resolution the card already applies once on load
  (explicit `x`/`y` > `focus_entity` > fit all entities), so it's a one-click
  way back to your configured view after panning/zooming. Ports upstream
  `ha-map-card`'s `mdi:image-filter-center-focus` control.
- "Toggle grouping" map button — bottom-left, only shown when
  `cluster_markers` is enabled. One click on/off for marker clustering,
  reusing the same overlay-visibility plumbing as the layer switcher's own
  "Clusters" checkbox, so the two stay in sync with each other. Ports
  upstream's `mdi:group` control.

  Both buttons render via a new generic `IconButtonControl` (a plain
  MapLibre `IControl`), placed bottom-left rather than stacked under the
  existing zoom/compass controls in top-right — stacking there was tried
  first and visually collided with the bottom-right attribution control on
  shorter map heights, confirmed via the dev harness.

## [0.6.1] - 2026-07-20

### Fixed

- `tile_layers:`/`wms:` raster overlays always rendered on top of every other
  entity overlay — `circle:`, `geojson:`, history trails, and the new
  `cluster_markers` bubbles — completely hiding them whenever both were
  configured together. `TileLayersRenderService.addLayer()` never specified
  a `beforeId`, so whichever overlay's layer got added to the map first
  simply ended up on the bottom of the stack; raster layers were the last
  ones added in `_buildMap()`'s `style.load` handler, so they always won.
  Raster overlays are now added first, so entity overlays created afterward
  correctly stack above them instead of being hidden underneath — confirmed
  visually via the dev harness (`npm run dev`) with a raster `tile_layers`
  overlay combined with `cluster_markers`/`circle`/history trails.

## [0.6.0] - 2026-07-19

### Added

- `history_show_lines`/`history_show_dots` card options — draw a dot per
  sampled history position (in addition to, or instead of, the connecting
  trail line). Previously accepted in config but silently ignored; history
  trails always drew a single connecting line with no way to see individual
  waypoints.
- `cluster_markers` card option — opt-in marker clustering: nearby entities
  collapse into a numbered bubble at low zoom (click, or zoom in, to expand),
  matching upstream `ha-map-card`'s clustering behavior. Individual entities
  keep their existing picture/icon marker look; only clustered groups render
  as a bubble. Ports the `cluster_markers` item from the porting backlog.

### Fixed

- A `map_styles:` entry's own `max_zoom`/`min_zoom` (added in 0.5.2) was only
  ever applied when the user picked that style via the layer switcher. If
  the *initially* active style (from `map_style`/`map_style_dark`) happened
  to match one of the named entries, its per-entry cap was ignored at
  construction time — only the wider card-level `max_zoom`/`min_zoom`
  applied — so a raster style capped tighter than the card level could still
  overshoot into blank tiles/400s on first load, before any switcher click.
  The initial `maplibregl.Map` construction now resolves the matching entry
  (if any) the same way `_onSelectBaseStyle` does, and the switcher now
  highlights that entry as active from the start instead of showing no
  selection.
- The visual card editor had no `max_zoom`/`min_zoom` fields at all — only
  `zoom` (the initial camera position) was exposed, so an existing
  card-level `max_zoom`/`min_zoom` was invisible and uneditable there
  (silently preserved on other edits only because the editor spreads the
  previous raw config first). Added alongside `zoom` in the card editor's
  grid row. (Per-`map_styles`-entry `max_zoom`/`min_zoom` were unaffected —
  those already round-tripped correctly.)

## [0.5.2] - 2026-07-19

### Fixed

- Base map styles (`map_styles:` entries) with real tile coverage narrower
  than the camera's allowed zoom could go blank/error past their own limit,
  even with `max_zoom` set at the card level: MapLibre does not
  automatically stop the *camera* at a raster source's declared `maxzoom` —
  it keeps requesting tiles at whatever zoom the camera reaches, and a
  strict tile provider (e.g. Bavaria's WMTS aerial imagery) then rejects
  those out-of-range requests with a 400 instead of serving a scaled
  fallback. `max_zoom`/`min_zoom` are now also accepted per-`map_styles`
  entry; the layer switcher applies that style's own limit to the camera the
  moment it's selected (falling back to the card-level `max_zoom`/`min_zoom`,
  then MapLibre's 0–22 default), so switching between styles with different
  real coverage — e.g. a capped regional aerial layer alongside an
  uncapped general vector style — always matches the active one.

## [0.5.1] - 2026-07-19

### Changed

- Layer switcher: once `map_styles:` is configured, the generic "Light"/
  "Dark" base-style options are no longer shown alongside them — they only
  duplicated (or conflicted with) whatever the user's own named styles
  already covered, with no clear relationship between a generic label and a
  custom one (e.g. a style literally named "Karte (hell)" next to a
  separate generic "Light" button). `map_style`/`map_style_dark` still
  drive the initial theme-follow behavior; they just don't get a dedicated
  switcher button when a full custom set is provided.

### Added

- `max_zoom`/`min_zoom` card options, capping how far the camera can zoom —
  useful when a raster `tile_layers`/`wms` overlay (or the base style
  itself) doesn't have imagery past a certain level, so zooming in stops at
  the last real tiles instead of going blank.
- `tile_layers`/`wms` `options.minzoom`/`options.maxzoom` are now actually
  applied to the raster source (previously silently dropped), for capping
  an individual overlay's own zoom range independently of the map's overall
  `max_zoom`/`min_zoom`.

## [0.5.0] - 2026-07-19

### Added

- A visual card editor: opening "Edit card" now shows a form instead of raw
  YAML, covering every card-level option (title, position/zoom, height,
  theme, map styles, projection, layer switcher, history range) plus a full
  entities list — add/remove/reorder entities, and edit each one's display,
  picture, icon, label, color, size, fixed position, z-index, focus-on-fit,
  and history fields. Built on Home Assistant's own `ha-form`/selector
  elements, so it looks and behaves like any other core card's editor.
  `circle`, `geojson`, `tile_layers`, and `wms` aren't in the visual editor
  yet — use the "Edit in YAML" toggle in the same dialog for those.

## [0.4.2] - 2026-07-19

### Fixed

- Layer switcher overlapping the title: 0.4.1 made the title part of the
  same flex column as the map, but the switcher's `position:absolute;
  top:8px; left:8px` was still scoped to that whole column, landing on top
  of the title bar instead of the map's own top-left corner. The map area
  now has its own positioning context, separate from the title, so the
  switcher is always anchored to the map regardless of whether a title is
  configured.

## [0.4.1] - 2026-07-19

### Fixed

- The real cause of the missing bottom-right attribution icon (the previous
  two fixes were real but incomplete): with a card `title:` configured,
  `ha-card`'s own built-in header added its height *on top of*
  `.nyxmap-viewport`'s already-explicit height instead of the two sharing
  it. The combined content could exceed `ha-card`'s box, and since `ha-card`
  clips to its own rounded corners, the excess got silently cut off the
  bottom — taking the attribution control (and anything else that lived
  there) with it. The title now renders as part of our own flex-column
  layout instead of `ha-card`'s built-in header, so the map area always
  gets exactly "whatever height is left" and can never overflow.

## [0.4.0] - 2026-07-19

### Added

- `tile_layers:`/`wms:` card-level config — raster overlays layered on top
  of the vector base style, registered with the layer switcher as
  toggleable overlays. `url` supports `{{ states('entity_id') }}`
  templating, re-resolved live as that entity's state changes. WMS requests
  are built as a raster tile-URL template around MapLibre's
  `{bbox-epsg-3857}` substitution token rather than hand-rolled BBOX math.
  (The `history`/WMS-TIME-parameter sub-config from upstream ha-map-card is
  deferred alongside the energy-dashboard date-range linking it depends on
  — see the Roadmap.)

### Fixed

- MapLibre's control icons (most visibly the bottom-right compact
  attribution "i") having their outer edge clipped: they're positioned
  flush in the corner (zero margin) by MapLibre itself, but `ha-card` clips
  to its own rounded corners (`overflow: hidden` + `border-radius`, needed
  so the map canvas's naturally square corners don't poke out past it) — a
  control with no inset sitting exactly in a rounded corner is guaranteed
  to have its outer edge cut off by the curve. Every corner's controls now
  get a small margin to clear it.

## [0.3.3] - 2026-07-19

### Fixed

- The attribution ("i") icon disappearing from the bottom-right corner: the
  0.3.2 fix made `:host { height: 100% }` unconditional so a percentage
  `height:` (e.g. Panel views) would cascade correctly, but that also let
  dashboard layouts that stretch card hosts to their own row height via CSS
  Grid (e.g. Home Assistant's Sections view) shrink `ha-card` to that
  external height instead of sizing to its content — clipping the bottom of
  the map, and whatever control lived there, even when no percentage height
  was configured at all. `height: 100%` on the host is now opt-in, applied
  only when a percentage/CSS-length height is actually configured.

## [0.3.2] - 2026-07-19

### Added

- `height:` now accepts a CSS length string (e.g. `"100%"`, `"50vh"`), not
  just a pixel number — mainly for a Home Assistant Panel view, where the
  card fills the whole viewport and a fixed pixel height can never match it
  exactly. A mismatched fixed height was the remaining cause of a page-level
  scrollbar (and the zoom control scrolling out of view with it) after the
  0.3.1 fixes: `height: 100%` now fills the panel exactly.

## [0.3.1] - 2026-07-19

### Fixed

- Layer switcher toggle button was invisible/unclickable: it shared the
  top-right corner with MapLibre's own `NavigationControl`, whose
  `.maplibregl-ctrl-top-right` container is `z-index: 2` in maplibre-gl's own
  CSS — higher than our control's `z-index: 1`, so it rendered underneath.
  Moved the switcher to the top-left corner and raised its z-index
  defensively.
- Dashboard scrollbar, take two: 0.3.0 fixed one cause (`getCardSize()`) but
  introduced another — un-clipping the layer switcher's dropdown panel (to
  stop it being cut off) also let it spill past `ha-card`'s box into the
  surrounding dashboard when opened, which is exactly what produces a
  page-level scrollbar. Reverted that clip change now that the switcher no
  longer needs to escape `ha-card`'s bounds to be usable (see above).

## [0.3.0] - 2026-07-19

### Added

- Native GeoJSON rendering (`geojson:` per-entity config) — points, lines, and
  polygons from any entity attribute, dispatched to the right MapLibre layer
  type automatically. Registered with the layer switcher as a toggleable
  overlay, and supports `hide_marker` to suppress the entity's own marker.

### Fixed

- Map staying undersized until switching Lovelace tabs: MapLibre's own
  container `ResizeObserver` silently drops the very first resize
  notification after construction, which could eat the corrective resize
  from Home Assistant's masonry/grid layout computing the card's real column
  width shortly after mount. The card now also observes its own container
  and nudges a resize once layout has settled.
- Layer switcher panel getting clipped: it lived inside the same
  `overflow: hidden` box used to round off the map canvas's corners, so its
  dropdown could be cut off on a short map. The clip now scopes to just the
  map canvas.
- `getCardSize()` could disagree with the actual rendered height when an
  explicit `height:` was set without a matching `card_size`, causing Home
  Assistant's masonry layout to under-allocate space for the card — visible
  as an unexpected scrollbar on the dashboard.

## [0.2.0] - 2026-07-18

### Added

- Circle markers (`circle:` per-entity config) — a geodesic circle around an
  entity, radius sourced from `gps_accuracy`, another state attribute, or a
  fixed value. Toggleable from the layer switcher.

## [0.1.0] - 2026-07-17

Initial HACS-installable release.

### Added

- Core card: MapLibre GL vector-tile rendering, entity markers with a
  picture → icon → initials fallback chain, tap-to-more-info.
- Light/dark map styles that follow Home Assistant's theme (`theme_mode`),
  with a `StyleReattach` registry so sources/layers survive `setStyle()`
  theme swaps.
- Per-entity history trails (`history_start`/`history_line_color`).
- Initial camera framing via `focus_entity`/`focus_follow`
  (`none`/`refocus`/`contains`), and auto-fit across all entities otherwise.
- 3D globe projection (default), togglable to flat mercator.
- Layer switcher panel: base map style selection + overlay visibility
  toggles.
- HACS packaging (`hacs.json`, release workflow publishing `nyxmap-card.js`
  as a GitHub Release asset).

[Unreleased]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.5.2...HEAD
[0.5.2]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ToxicTolerance/ha-nyxmap-card/releases/tag/v0.1.0
