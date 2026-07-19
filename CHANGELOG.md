# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ToxicTolerance/ha-nyxmap-card/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ToxicTolerance/ha-nyxmap-card/releases/tag/v0.1.0
