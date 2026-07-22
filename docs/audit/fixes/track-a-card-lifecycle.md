# Track A — card lifecycle & camera

> **Superseded — historical record.** This is a point-in-time artifact of the
> v0.9.1 audit, kept for provenance. Much of it has since been fixed and parts
> of it are now simply wrong about the current tree (it predates the CI
> coverage gate, the whole-project lint, the removal of `loadMapLibreFromCdn`,
> and the `OverlaySource` extraction it recommends). Do **not** read it as a
> description of the project today — see `CHANGELOG.md` for what landed and
> `CLAUDE.md` for the current architecture and backlog.

Fixes for findings **§1, §2, §4, §5, §6, §11** of `docs/audit/code-review-findings.md`
(baseline `1b7bc2d`). Files touched:

- `src/components/NyxmapCard.ts`
- `src/components/NyxmapCard.test.ts`
- `src/services/render/InitialViewRenderService.ts`
- `src/services/render/InitialViewRenderService.test.ts`

`src/components/NyxmapCard.styles.ts` was in scope but needed no change.

---

## §1 — The MapLibre `Map` is never destroyed

**Changed**

- `NyxmapCard.ts:169-188` — `disconnectedCallback()` now schedules a deferred teardown
  (`setTimeout(…, 0)`) instead of only tidying the observer/rAF. Deferred, not synchronous,
  because Lit disconnects on benign re-parenting too (HA's Sections/masonry layouts do exactly
  that).
- `NyxmapCard.ts:144-166` — new `connectedCallback()` cancels a pending teardown when the element
  comes back.
- `NyxmapCard.ts:190-220` — new `_teardown()`: bails if `isConnected` (belt-and-braces), calls
  `this._map.remove()`, nulls `_map`/`_resizeObserver`, drops every service bound to the dead map
  (`_entities`, `_history`, `_circles`, `_geojson`, `_cluster`, `_tileLayers`, `_pluginHost`,
  `_clusterToggleControl`), clears `_reattach`, unregisters the layer-registry **overlays**, and
  resets `_built`/`_ready`/`_activeStyleUrl`/`_initialViewApplied`/`_historyCatchUpDone`.
- Rebuild path: `connectedCallback()` calls `this.requestUpdate()` when the element returns after a
  teardown, so `updated()`'s existing `!this._built && this._config` branch re-runs `_buildMap()`
  against the (still-present) shadow root.

**Why**: `Map.remove()` is the only thing that releases the WebGL context, the worker pool,
MapLibre's own container `ResizeObserver` and its window/document listeners. Browsers cap
simultaneous WebGL contexts; HA's frontend is a long-lived tab that builds a fresh card per
dashboard view and per keystroke in the Edit-card preview.

Base styles are deliberately **not** unregistered in `_teardown()` — `_buildMap()` calls
`_syncBaseStyles()` (idempotent `Map.set` + prune) on rebuild, and keeping them means the switcher's
`_manualStyleId` selection survives a re-parent. Overlays *are* unregistered because their
`setVisible` closes over layer ids that only existed in the destroyed style.

**Tests** (`NyxmapCard.test.ts`, `describe("lifecycle (teardown / reconnect)")`):

- "destroys the map when the element is really removed" — asserts `map.remove()` once, `_map`
  undefined.
- "does not destroy the map on a benign re-parent" — remove + re-append in the same task, asserts
  `remove()` *not* called and the same `Map` instance is retained.
- "rebuilds the map when the element is re-added after a real teardown" — asserts a *new* `Map`, and
  that `style.load` on it still drives the render services (entity marker present).

`FakeMap` gained a `remove = vi.fn()`.

---

## §2 — `ResizeObserver` never re-observed on reconnect

**Changed**

- `NyxmapCard.ts:222-227` — new `_observeContainer()`: lazily creates the observer
  (`??=`) and `observe()`s the container. Idempotent, so it is safe from both call sites.
- `NyxmapCard.ts:518` — `_buildMap()` now calls it instead of constructing/observing inline.
- `NyxmapCard.ts:152-161` — `connectedCallback()` calls `_observeContainer()` **and**
  `this._map.resize()` when `_built && _map`, i.e. after a re-parent that did not tear down.

**Why**: the observer was created once inside `_built`-guarded `_buildMap()` and disconnected on
every disconnect, so one re-parent permanently killed resize handling.

**Test**: "re-observes the container after a re-parent, so resizes still reach the map" — spies
`window.ResizeObserver.prototype.observe`, removes and re-appends the element, asserts `observe`
was called again and `map.resize()` fired.

---

## §4 — `_ready` never cleared on `setStyle()`

**Changed**

- `NyxmapCard.ts:119-124` — new `_applyStyle(url)`, the single funnel for `map.setStyle()`. Clears
  `_ready` when the URL actually differs from `_activeStyleUrl`, records the new URL, then calls
  `setStyle`. `_ready` is restored by the existing `"style.load"` handler.
- Call sites converted: `setConfig` (`:89`), `_onSelectThemeMode` (`:349`), `_onSelectBaseStyle`
  (`:373`).
- `NyxmapCard.ts:71` — new `_activeStyleUrl` field, seeded in `_buildMap()` (`:474-477`, the
  constructor now consumes the same value) and cleared in `_teardown()`.

**Why**: MapLibre's `Style.addSource()` throws `"Style is not done loading."` between `setStyle()`
and the next `style.load`. `_ready` latched `true` forever, so a routine `hass` update landing in
that window ran the render services and threw out of `updated()`.

Only a *changed* URL clears `_ready`: an identical URL takes MapLibre's style-diff path, which keeps
the old style loaded and does not re-fire `style.load` — clearing `_ready` there would strand the
card permanently un-ready. This is also what makes §11 below decidable.

**Test**: `describe("style swaps")` → "does not touch the render services while a style swap is
still loading". `FakeMap` now models `Style._loaded`: `addSource` **throws** unless `styleLoaded`,
`setStyle` to a different URL clears it, `fire("style.load")` sets it. The test swaps `map_style`,
pushes a fresh `hass` mid-swap, asserts the `addSource` call count is unchanged (and that the
`updateComplete` promise doesn't reject), then fires `style.load` and asserts it resumes.

---

## §5 — `focus_follow: "refocus"` re-fits on every `hass` change

**Changed**

- `InitialViewRenderService.ts:50` — new `_lastFitted?: BoundsLike`, written by `_fit()` (`:111`).
- `InitialViewRenderService.ts:104` — `updateFit()` skips the `"refocus"` fit when the freshly
  computed (unpadded) bounds equal the last bounds this service actually fitted.
  `boundsEqual()` helper at `:30-32`.

**Why**: the card's `updated()` gate is `changed.has("hass")` and HA assigns a new `hass` on every
state change anywhere in the instance. Re-fitting unconditionally pinned the camera — any pan/zoom
gesture was undone milliseconds later by an unrelated sensor.

**Deliberately not done**: the audit's primary suggestion was to diff the tracked entities' state
slices in `updated()` and skip the *whole* block (markers, circles, GeoJSON, clusters). That is a
much larger behavioural change — it would also suppress non-positional updates the marker/circle/
GeoJSON services legitimately consume (`entity_picture`, `icon`, `gps_accuracy`, geojson attributes,
and the `display: state` value once §8 lands) — and it overlaps Track B/C's ownership of those
services. I implemented the audit's stated minimum ("at minimum, gate `updateFit` on an actual
bounds change") in the file I own. The residual cost the audit notes — full marker/cluster
reconciliation, including `ClusterRenderService`'s O(n²) pair scan, on every unrelated state change
— is **not** addressed here.

**Tests** (`InitialViewRenderService.test.ts`):

- "'refocus' does not re-fit while the tracked entities stay put" — three `updateFit` calls with
  three distinct `hass` objects carrying identical positions → exactly one `fitBounds`.
- "'refocus' fits again once a tracked entity has actually moved" → two `fitBounds`.

---

## §6 — Fitting a single entity zooms to max zoom

**Changed** (at the call site, not in `src/util/geo.ts` — that file is out of my scope, and
`padBounds` is a faithful port of Leaflet's `LatLngBounds.pad()` that other callers may rely on):

- `InitialViewRenderService.ts:110-124` — new private `_fit(map, bounds, pointZoom)` does the
  padding, and when the padded box is still zero-area (`east === west && north === south`) calls
  `map.jumpTo({ center, zoom: pointZoom })` instead of `fitBounds`.
- `fitAllEntities()` (`:71-79`) and `updateFit()` (`:84-106`) take an optional trailing
  `pointZoom`, defaulting to `DEFAULT_POINT_ZOOM = 12` (`:11`) to mirror `MapConfig`'s own `zoom`
  default.
- `NyxmapCard.ts:266-272` (`updateFit`) and `:738-743` (`fitAllEntities`) pass `this._config.zoom`.

**Why**: `fitBounds` on a zero-area box computes an infinite scale factor and clamps to `maxZoom`,
so the most common possible config (one entity, no `x`/`y`/`focus_entity` — what `buildStubConfig`
produces) opened at building level instead of the configured `zoom`.

**Tests**:

- `InitialViewRenderService.test.ts`: "centers a single entity at the given zoom instead of fitting
  a zero-area box" and "treats several entities sharing one position as a single point too" — both
  assert `fitBounds` *not* called and `jumpTo({center, zoom})` called.
- `NyxmapCard.test.ts`: new "clicking 'Reset focus' with a single entity centers it at the
  configured zoom instead of slamming to max zoom" (end-to-end through the card).
- Two pre-existing tests were degenerate-by-accident and had to be broadened to keep testing what
  their titles claim (they'd otherwise have been asserting the new single-point path):
  - `InitialViewRenderService.test.ts` "excludes entities with focus_on_fit: false" now uses two
    included entities and asserts the padded west/east explicitly.
  - `NyxmapCard.test.ts` "clicking 'Reset focus' fits all entities…" now configures two entities.
  - The `updateFit` describe's shared fixture is two entities; each test also builds its own
    service instance now, since `_lastFitted` is per-instance state that would otherwise leak
    between tests.

---

## §11 — Config change that doesn't alter the resolved style URL leaves overlays stale

**Changed**

- `NyxmapCard.ts:631-641` — extracted `_refreshOverlays()` (tile layers → entities/clusters →
  geojson, preserving the documented z-order rationale) from the two places that previously
  inlined it.
- `NyxmapCard.ts:264` (`updated()`'s hass branch) and `:609` (the `style.load` handler) now call it.
- `NyxmapCard.ts:86-110` — `setConfig()` computes `styleChanged` against `_activeStyleUrl`; when the
  style did **not** change (so no `style.load` will re-fire) and the card is `_ready` with a `hass`,
  it calls `_refreshOverlays()`, resets `_historyCatchUpDone` and calls `_refreshHistory()`.

**Why**: `setStyle()` with an unchanged URL doesn't re-fire `style.load` — the reason
`_syncClusterToggleControl()` was already called directly — so an entity added, an entity colour
changed or a `tile_layers.url` edited never reached the render services until the next unrelated
`hass` object. In HA's Edit-card preview, which often holds a static `hass`, that is "never".

History is re-fetched on the same branch because `history_start`/`entities` are plausibly what
changed. Note this inherits finding §7's missing `.catch()` on the `_refreshHistory()` promise
chain — **not** fixed here, it's outside this track.

**Test**: `describe("style swaps")` → "re-runs the render services on a config change that leaves
the style URL unchanged" — adds an entity via `setConfig` with **no** new `hass` afterwards and
asserts the new marker exists.

---

## Deliberately not done

- **§5's full fix** (diffing tracked entity state in `updated()`) — see above.
- **`padBounds` itself** (§6) was left alone; `src/util/geo.ts` is outside this track's file list.
  The degenerate case is handled at the only two call sites that fit a camera.
- **`maxZoom` option on `fitBounds`** (a secondary suggestion in §6) — `MapViewLike.fitBounds`
  takes only bounds, and the camera is already capped by `max_zoom` / the active style's own cap
  via `setMaxZoom`. Adding an options argument would widen the interface for no behaviour change
  now that the degenerate case never reaches `fitBounds`.
- **§7** (`Promise.all` / missing `.catch` in `_refreshHistory`) and **§12** (history never
  refreshed) were noticed while working in `_refreshHistory()` but belong to another track and were
  left untouched.
- **§3** (`StyleReattach.replayAll` isolation) was already fixed in the working tree by a sibling
  track; `StyleReattach.ts` was not touched here.

---

## Verification

All three commands run against the working tree at the end of this track.
`npm run test:coverage` was deliberately **not** run.

```
$ npm run typecheck

> ha-nyxmap-card@0.9.1 typecheck
> tsc --noEmit

```

```
$ npm run lint

> ha-nyxmap-card@0.9.1 lint
> eslint src

```

```
$ npm test
 ✓ src/components/NyxmapCard.test.ts (44 tests) 792ms
 ✓ src/services/render/GeoJsonRenderService.test.ts (10 tests) 44ms
 ✓ src/services/render/TileLayersRenderService.test.ts (11 tests) 42ms
 ✓ src/configs/MapConfig.test.ts (19 tests) 25ms
 ✓ src/editor/CardFormSchema.test.ts (14 tests) 23ms
 ✓ src/models/EntityHistoryManager.test.ts (8 tests) 21ms
 ✓ src/editor/EntityFormSchema.test.ts (14 tests) 19ms
 ✓ src/maplibre/StyleReattach.test.ts (8 tests) 26ms
 ✓ src/util/HaMapUtilities.test.ts (14 tests) 19ms
 ✓ src/configs/EntityConfig.test.ts (8 tests) 14ms
 ✓ src/services/HaHistoryService.test.ts (4 tests) 16ms
 ✓ src/models/Circle.test.ts (8 tests) 12ms
 ✓ src/maplibre/MarkerFactory.test.ts (11 tests) 56ms
 ✓ src/maplibre/MarkerAnimator.test.ts (6 tests) 45ms
 ✓ src/services/HaUrlResolveService.test.ts (5 tests) 11ms
 ✓ src/maplibre/IconButtonControl.test.ts (4 tests) 49ms
 ✓ src/configs/LayerConfig.test.ts (7 tests) 18ms
 ✓ src/services/render/LayerRegistry.test.ts (4 tests) 15ms
 ✓ src/util/geo.test.ts (8 tests) 15ms
 ✓ src/models/GeoJson.test.ts (6 tests) 13ms
 ✓ src/configs/CircleConfig.test.ts (6 tests) 12ms
 ✓ src/editor/MapStyleFormSchema.test.ts (2 tests) 9ms
 ✓ src/configs/GeoJsonConfig.test.ts (4 tests) 11ms
 ✓ src/models/EntityHistory.test.ts (2 tests) 5ms

 Test Files  33 passed (33)
      Tests  332 passed (332)
   Start at  12:58:16
   Duration  9.35s (transform 2.45s, setup 315ms, collect 5.24s, tests 2.46s, environment 24.90s, prepare 10.25s)
```

Note: the run above includes a sibling track's in-flight edits (`StyleReattach.test.ts` is at 8
tests rather than the audit baseline's 4). The 310 → 332 delta is not all mine; this track added
4 tests to `InitialViewRenderService.test.ts` and 6 to `NyxmapCard.test.ts`.
