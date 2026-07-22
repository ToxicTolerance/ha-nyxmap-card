# Code review findings — defect audit

> **Superseded — historical record.** This is a point-in-time artifact of the
> v0.9.1 audit, kept for provenance. Much of it has since been fixed and parts
> of it are now simply wrong about the current tree (it predates the CI
> coverage gate, the whole-project lint, the removal of `loadMapLibreFromCdn`,
> and the `OverlaySource` extraction it recommends). Do **not** read it as a
> description of the project today — see `CHANGELOG.md` for what landed and
> `CLAUDE.md` for the current architecture and backlog.

- **Date:** 2026-07-21
- **Commit reviewed:** `1b7bc2d` (v0.9.1, branch `master`, clean tree)
- **Scope:** all of `src/`, plus `test/`, `dev/`, `.github/workflows/`, `vite.config.ts`,
  `tsconfig.json`, `eslint.config.js`.
- **Tooling:** `npm run typecheck` — clean. `npm run lint` — clean. `npm test` — 33 files,
  310 tests, all passing. **No tool-reported failures**; every finding below comes from
  reading the source.

**Summary.** The codebase is in good shape: the render services consistently honour the
`StyleReattach` invariant (every `addSource`/`addLayer` producer — `HistoryRenderService`,
`CircleRenderService`, `GeoJsonRenderService`, `TileLayersRenderService`, `PluginHost` —
registers a replay factory, and `ClusterRenderService`/`EntitiesRenderService` correctly
opt out because they use HTML markers), config parsers defensively handle missing/wrong-typed
entity attributes, and coverage is broad. The defects that remain cluster in three places.
First, **lifecycle**: `NyxmapCard.disconnectedCallback()` never calls `map.remove()`, so a
WebGL context, MapLibre's worker pool, and its window/document listeners leak per card
teardown, and the `ResizeObserver` it *does* disconnect is never re-observed on reconnect.
Second, **async ordering**: `_ready` is latched `true` on the first `style.load` and never
cleared, so any `hass` update or late-resolving history fetch landing in the
`setStyle()` → `style.load` window calls `addSource` on a style MapLibre considers unloaded
(it throws by design); and `StyleReattach.replayAll` has no per-factory isolation, so one
throwing overlay factory — exactly what a third-party plugin can supply — aborts the entire
`style.load` handler and everything downstream of it. Third, a handful of **correctness gaps**
where a documented config surface silently does nothing (`display: state`) or misbehaves
(`focus_follow: refocus` re-fitting on every unrelated state change; single-entity fits
slamming the camera to max zoom; one failing history fetch dropping every trail).

Findings are ranked most-severe first. Nothing here has been changed in the tree.

---

## 1. The MapLibre `Map` is never destroyed — WebGL context, workers, and listeners leak per card

- **Location:** `src/components/NyxmapCard.ts:109-113` (`disconnectedCallback`); map created at
  `src/components/NyxmapCard.ts:371`.
- **Severity:** High
- **What's wrong:** `disconnectedCallback()` disconnects the `ResizeObserver` and cancels a
  pending rAF, but never calls `this._map.remove()`. `maplibregl.Map.remove()` is what releases
  the WebGL context, terminates/releases the worker pool, removes MapLibre's own
  `ResizeObserver` on the container, and detaches its `window`/`document` listeners. Nothing
  else in the repo calls it (`grep` for `.remove()` in `NyxmapCard.ts` finds only
  `removeControl`).
- **Failure scenario:** A user has nyxmap cards on several dashboard views and navigates
  between them (or repeatedly opens/closes the "Edit card" dialog, whose preview constructs a
  fresh `nyxmap-card` on every keystroke-triggered `config-changed`). Each destroyed element
  leaves a live `Map`. Browsers cap simultaneous WebGL contexts (~8–16); once the cap is hit,
  the oldest contexts are force-lost and previously-working maps render blank/black, while
  memory and worker count climb for the lifetime of the (long-lived) HA frontend tab.
- **Suggested fix:** Tear down in `disconnectedCallback()` — but not synchronously, since Lit
  elements are also disconnected on benign re-parenting. Schedule teardown on a microtask/timeout
  and cancel it from a new `connectedCallback()` if the element comes back; on real teardown call
  `this._map.remove()`, null `_map`, reset `_built`/`_ready`, and clear `_reattach`. Rebuild from
  `updated()` on reconnect.
- **Confidence:** Confirmed.

---

## 2. `ResizeObserver` is disconnected on disconnect and never re-observed on reconnect

- **Location:** `src/components/NyxmapCard.ts:111` and `src/components/NyxmapCard.ts:414-415`.
- **Severity:** High
- **What's wrong:** The observer is created exactly once, inside `_buildMap()`, which is guarded
  by `_built` and therefore runs only once per element. `disconnectedCallback()` calls
  `this._resizeObserver?.disconnect()` unconditionally. There is no `connectedCallback()` anywhere
  in `src/` to re-`observe()`.
- **Failure scenario:** HA's Sections/masonry layouts re-parent card elements when a view is
  edited or reflowed; Lit fires `disconnectedCallback` then `connectedCallback` on the *same*
  element. After that round trip `_built` is still `true`, so `_buildMap()` never re-runs and the
  observer stays disconnected. The card then no longer reacts to container resizes — toggling the
  HA sidebar or resizing the window leaves the map canvas stuck at its old pixel size (visibly
  stretched/letterboxed) until a full page reload. This is precisely the class of bug the
  observer was added to fix (see the comment at `NyxmapCard.ts:403-413`).
- **Suggested fix:** Add a `connectedCallback()` that re-observes the container when `_built &&
  _map` (and calls `this._map.resize()` once), or move observation into `updated()` guarded by an
  `_observing` flag.
- **Confidence:** Confirmed.

---

## 3. `StyleReattach.replayAll` has no per-factory isolation — one throwing factory aborts the whole `style.load` handler

- **Location:** `src/maplibre/StyleReattach.ts:30-32`; consumed at
  `src/components/NyxmapCard.ts:499`.
- **Severity:** High
- **What's wrong:** `replayAll` is a bare `for (const factory of this.factories.values())
  factory(map);`. The `style.load` handler calls it at line 499 and then, *after* it, does
  everything else that matters: `_pluginHost.activate()`, `_tileLayers.update()`,
  `_updateEntitiesAndClusters()`, `_geojson.update()`, `_refreshHistory()`,
  `_applyInitialViewIfNeeded()` (lines 504-518). An exception from any single factory propagates
  out of `replayAll`, skipping every remaining factory *and* all of that follow-up work.
- **Failure scenario:** A third-party plugin calls
  `ctx.registerOverlay("x", {source, layers:[…]})` with a layer spec MapLibre rejects (bad paint
  property, duplicate layer id, `source` typo). On first `style.load` this is harmless — the
  `_addOverlay` happens inside `activate()`, which is try/caught. But the plugin's factory is now
  in `_reattach`. On the **next theme swap**, `replayAll` reaches it, `map.addLayer` throws, and
  the handler dies mid-way: any overlay registered after it is never re-added, tile layers,
  circles, GeoJSON shapes and history trails silently vanish, and the initial-view/history
  refresh never runs. The card looks broken with only a console stack trace to explain it —
  the exact "a misbehaving plugin can't take the card down" guarantee documented at
  `PluginHost.ts:56` does not hold past the first style load.
- **Suggested fix:** Wrap each factory invocation in try/catch inside `replayAll`, logging the
  offending id and continuing. Optionally evict a factory that throws twice. Secondary note:
  `factories` is a live `Map` being iterated, so a factory that calls `reattach.register()` with a
  fresh id during replay will be visited in the same pass — a self-registering factory loops
  forever. Snapshotting (`[...this.factories]`) fixes both concerns at once.
- **Confidence:** Confirmed (code path traced; MapLibre's `addLayer` throwing on an invalid spec
  is standard library behaviour).

---

## 4. `_ready` is never cleared on `setStyle()`, so updates during a style swap call `addSource` on an unloaded style

- **Location:** `src/components/NyxmapCard.ts:149` (the `_ready` gate), set at
  `src/components/NyxmapCard.ts:489`; swaps issued at lines 80, 246, 270.
- **Severity:** High
- **What's wrong:** `_ready` is latched `true` on the first `style.load` and never reset. Every
  `setStyle()` call replaces the map's `Style` with a fresh, unloaded one for the duration of the
  new style's fetch+parse. MapLibre guards this explicitly: in the bundled
  `maplibre-gl@5.24.0`, `Style.addSource` begins with `this._checkLoaded()`, which throws
  `new Error("Style is not done loading.")` when `_loaded` is false.
- **Failure scenario:** The user picks a different base style from the layer switcher
  (`_onSelectBaseStyle` → `setStyle`). A remote style JSON takes a few hundred ms. During that
  window HA pushes a routine state update (it does so on *any* entity change in the whole
  instance — see finding 5): Lit's `updated()` sees `changed.has("hass") && this._ready` as true
  and runs `_tileLayers.update()` / `_circles.update()` / `_geojson.update()`. Each does
  `getSource(id)` → `undefined` (new style) → `addSource(...)` → **throws**, aborting the rest of
  `updated()`. The same window is reachable from the history path: `_refreshHistory()`'s
  `.then()` (line 635) has no ordering guard at all, so a WebSocket history response landing
  mid-swap calls `HistoryRenderService.update` → `addSource` → throws inside an unhandled
  promise chain.
- **Suggested fix:** Set `this._ready = false` immediately before every `setStyle()` call (it is
  restored by the `style.load` handler), and additionally gate the render services on
  `this._map.isStyleLoaded()` at their call sites. Note the window is narrower on MapLibre's
  style-*diff* path (the old style stays loaded during the fetch), but the diff falls back to a
  full `_updateStyle` rebuild whenever it hits an unimplemented operation — which is the common
  case between two unrelated third-party style JSONs.
- **Confidence:** Confirmed for our code; the throwing guard is verified in the bundled
  `node_modules/maplibre-gl/dist/maplibre-gl.js` (`_checkLoaded(){if(!this._loaded)throw new
  Error("Style is not done loading.")}` and `addSource(e,i,o={}){…this._checkLoaded()…}`).

---

## 5. `focus_follow: "refocus"` re-fits the camera on *every* `hass` object change, not on entity movement

- **Location:** `src/components/NyxmapCard.ts:149` and `164-169`
  (`_initialView.updateFit`); logic at `src/services/render/InitialViewRenderService.ts:66-78`.
- **Severity:** High
- **What's wrong:** The `updated()` gate is `changed.has("hass")`, and Home Assistant assigns a
  brand-new `hass` object on every state change *anywhere in the instance*. There is no
  comparison of the previous vs. current states of the configured entities. `updateFit` with
  `focus_follow: "refocus"` then calls `map.fitBounds(...)` unconditionally.
- **Failure scenario:** A typical HA install has sensors updating multiple times per second. With
  `focus_follow: refocus` configured, the card issues `fitBounds` at that same rate even though no
  tracked entity has moved. The user cannot pan or zoom — the camera snaps back within
  milliseconds of every gesture. (`focus_follow: "contains"` is largely spared because
  `boundsContains` short-circuits, but it still runs a bounds computation per update.) The same
  gate also drives full marker/cluster/circle/GeoJSON reconciliation, including
  `ClusterRenderService._recompute()`'s O(n²) pair scan, on every unrelated state change.
- **Suggested fix:** In `updated()`, compare the configured entities' relevant state slices
  (lat/lng/accuracy/picture/icon) between `changed.get("hass")` and `this.hass` and skip the whole
  block when nothing tracked changed — the standard HA custom-card pattern. At minimum, gate
  `updateFit` on an actual bounds change.
- **Confidence:** Confirmed.

---

## 6. Fitting a single entity zooms the camera to max zoom

- **Location:** `src/util/geo.ts:29-38` (`padBounds`); callers at
  `src/services/render/InitialViewRenderService.ts:57-61` and `:66-78`.
- **Severity:** High
- **What's wrong:** `padBounds` scales by `width`/`height` of the bounding box. For a single
  point (or several entities at an identical position) `width === height === 0`, so padding adds
  nothing and the padded bounds remain a degenerate zero-area box. `map.fitBounds` on a zero-size
  bounds computes an infinite scale factor and clamps to the map's `maxZoom`.
- **Failure scenario:** The most common possible config —
  `type: custom:nyxmap-card` with `entities: [device_tracker.phone]` and no `x`/`y`/`focus_entity`
  (exactly what `buildStubConfig` produces, `src/editor/CardFormSchema.ts:119-122`) —
  takes the `getInitialCenter() === null` branch in `_applyInitialView`
  (`NyxmapCard.ts:614-622`), calls `fitAllEntities`, and lands the camera at zoom 22, i.e.
  building-level, so the user sees a featureless close-up instead of their configured `zoom: 12`.
  Same result whenever "Reset focus" is clicked in that config.
- **Suggested fix:** In `padBounds` (or at the `fitAllEntities` call site) treat a degenerate box
  specially — e.g. if `width === 0 && height === 0`, `jumpTo({center: thatPoint, zoom:
  config.zoom})` instead of fitting; or apply an absolute minimum padding in degrees. Also worth
  passing a `maxZoom` option to `fitBounds`.
- **Confidence:** Confirmed for our code; the clamp-to-maxZoom behaviour of `fitBounds` on a
  zero-size bounds is standard MapLibre `cameraForBounds` arithmetic.

---

## 7. One failing history fetch discards every entity's trail, permanently

- **Location:** `src/models/EntityHistoryManager.ts:26-43` (`Promise.all`) and
  `src/components/NyxmapCard.ts:627-642` (`_refreshHistory`).
- **Severity:** Medium
- **What's wrong:** `refresh()` awaits `Promise.all(entities.map(...))`, so a single rejected
  `fetchPath` rejects the aggregate. `_refreshHistory` consumes it as
  `void this._historyManager.refresh(...).then(...)` — a `.then` with **no `.catch`**. It also
  sets `_historyCatchUpDone = true` *before* awaiting (line 629), so the catch-up path in
  `updated()` will never retry.
- **Failure scenario:** A card lists three entities with `history_start`. One of them was renamed
  or removed in HA, so `history/history_during_period` errors for it. `Promise.all` rejects →
  `this._history.update(histories)` never runs → **none** of the three trails render, and the
  layer switcher shows no history overlays. The only signal is an unhandled-rejection warning in
  the console. Because the failure happens at `style.load` time and `_historyCatchUpDone` is
  already latched, nothing retries until a manual theme swap.
- **Suggested fix:** Use `Promise.allSettled` (or wrap each per-entity fetch in its own
  try/catch that logs and returns) so one bad entity degrades to "no trail for that entity", and
  add a `.catch()` to the `_refreshHistory` chain. Move the `_historyCatchUpDone = true`
  assignment into the settled path.
- **Confidence:** Confirmed.

---

## 8. `display: "state"` is offered in the visual editor but never rendered

- **Location:** `src/maplibre/MarkerFactory.ts:20-41` (`buildMarkerElement`); type at
  `src/configs/EntityConfig.ts:4`; exposed at `src/editor/EntityFormSchema.ts:46`.
- **Severity:** Medium
- **What's wrong:** `EntityDisplay` is `"marker" | "icon" | "state"` and the editor dropdown
  offers all three, but `buildMarkerElement` only ever tests `entityCfg.display !== "icon"`.
  A repo-wide grep for `"state"` outside tests finds only the type declaration and the dropdown —
  nothing consumes it.
- **Failure scenario:** A user picks "state" in the visual editor for
  `sensor.outdoor_temperature`, expecting the marker to show the current value (as upstream
  `ha-map-card` does). The marker renders identically to `display: marker` (picture → icon →
  initials), the state value never appears, and there is no warning. The setting is
  indistinguishable from a no-op.
- **Suggested fix:** Either implement the branch (`if (entityCfg.display === "state")` →
  `el.textContent = stateObj?.state` with the `--initials`-style class) or remove `"state"` from
  the `EntityDisplay` union and the editor dropdown until it is implemented.
- **Confidence:** Confirmed.

---

## 9. Marker DOM is built once and never rebuilt, so picture/icon/label go stale

- **Location:** `src/services/render/EntitiesRenderService.ts:91-102`.
- **Severity:** Medium
- **What's wrong:** `buildMarkerElement(ent, st)` is called only in the `if (!tracked)` branch.
  On every subsequent update the code does `tracked.marker.setLngLat(lngLat)` and nothing else —
  no re-render of the element against the new state object.
- **Failure scenario:** A `person` entity's `entity_picture` changes (new profile photo, or HA
  rotates the signed `/api/image_proxy/...` token — those URLs expire). The marker keeps the old
  `background-image` URL forever and eventually renders as a broken/blank circle until the card is
  fully rebuilt. Same for an entity whose `icon` attribute changes with state (a common template
  pattern: `mdi:home` vs `mdi:car`) and for `friendly_name`-derived initials after a rename.
- **Suggested fix:** Compute a small identity key from the inputs `buildMarkerElement` reads
  (`picture`, `icon`, `friendly_name`, `color`, `size`, and `state` once finding 8 is fixed);
  when it differs from the stored key, rebuild the inner element in place (replace the child of
  the animation wrapper, preserving the `Marker` so positioning/clustering state survives).
- **Confidence:** Confirmed.

---

## 10. A plugin overlay id that collides with an internal overlay clobbers it instead of being rejected

- **Location:** `src/maplibre/PluginHost.ts:119-142` (`_registerOverlay`) and `:147-157`
  (`_addOverlay`).
- **Severity:** Medium
- **What's wrong:** On collision the code logs a warning and then proceeds anyway. `_addOverlay`
  bails early (`if (map.getSource(id)) return;`) so the plugin's own source/layers are silently not
  added, but `reattach.register(id, …)` and `layerRegistry.registerOverlay(id, …)` both
  **overwrite** the internal service's entries (`StyleReattach.register` and
  `LayerRegistry.registerOverlay` are plain `Map.set`).
- **Failure scenario:** A plugin registers `registerOverlay("history-device_tracker.phone", …)`
  (or any id in the `history-*` / `circle-*` / `geojson-*` / `tile-layer-N` namespaces). Nothing
  visibly breaks at first. On the next theme swap, `replayAll` runs the *plugin's* factory under
  that id, so the entity's history trail is never re-added — and because
  `HistoryRenderService.active` still contains the entity, its next `_upsert` finds the plugin's
  source via `getSource(id)` and just calls `setData` on it, corrupting the plugin overlay with
  trail geometry while the trail's own layers stay missing. The layer switcher meanwhile shows the
  plugin's label with the plugin's `setVisible`, which targets layer ids that don't exist. Neither
  side recovers without a page reload.
- **Suggested fix:** Make collision a hard reject — return early (after the warning) without
  registering anything — or auto-namespace plugin ids (e.g. prefix `plugin:` when absent) and
  reserve the internal prefixes.
- **Confidence:** Confirmed.

---

## 11. A config change that doesn't alter the resolved style URL leaves overlays stale until the next `hass` update

- **Location:** `src/components/NyxmapCard.ts:71-89` (`setConfig`).
- **Severity:** Medium
- **What's wrong:** After the first build, `setConfig` calls `_syncBaseStyles()`, `setStyle(...)`,
  and `_syncClusterToggleControl()` — but nothing that re-runs the render services. The comment at
  lines 81-86 already acknowledges that `setStyle()` does not reliably re-fire `style.load` when
  the URL is unchanged, which is exactly why `_syncClusterToggleControl()` is called directly; the
  same reasoning was not applied to entities/circles/GeoJSON/tile layers/history.
- **Failure scenario:** In the dashboard YAML editor a user adds an entity, changes an entity's
  `color`, or edits `tile_layers.url`, without touching any style key. `style.load` doesn't fire,
  so `_entities.update()` / `_tileLayers.update()` are never called from `setConfig`. The change
  only appears when the next unrelated `hass` object arrives. In a quiet instance — and, more
  reliably, in HA's "Edit card" **preview pane**, which often holds a static `hass` — the edit
  appears to do nothing at all.
- **Suggested fix:** After `setStyle` in `setConfig`, if `_ready && this.hass`, re-run the same
  block the `hass` branch of `updated()` runs (tile layers → entities/clusters → geojson →
  history). Also consider resetting `_historyCatchUpDone` so history is re-fetched when
  `history_start`/entities change.
- **Confidence:** Confirmed.

---

## 12. History is fetched exactly once per style load and never refreshed

- **Location:** `src/components/NyxmapCard.ts:516` (only unconditional call) and `:173`
  (one-shot catch-up guarded by `_historyCatchUpDone`).
- **Severity:** Medium
- **What's wrong:** There is no timer, no re-fetch on `hass` change, and no
  `energy-date-selection` subscription (the last is acknowledged as backlog in CLAUDE.md). The
  only re-fetch trigger is another `style.load`, i.e. a theme/base-style swap.
- **Failure scenario:** A wall-mounted dashboard is left open for a day with
  `history_start: "5 hours ago"`. The device tracker's marker moves throughout the day, but the
  trail behind it is frozen at whatever was fetched when the page loaded — and its window is still
  anchored to that load time, so it drifts progressively further out of date. Nothing indicates
  the trail is stale.
- **Suggested fix:** Refresh on an interval (e.g. every 1–5 minutes, cleared in
  `disconnectedCallback`) or when a tracked entity's `last_updated` advances, with an in-flight
  guard so overlapping fetches don't interleave. Pair with an abort/generation token so a response
  arriving after teardown or after a newer request is discarded (relevant to finding 4 as well).
- **Confidence:** Confirmed.

---

## 13. A `map_styles` entry without `map_style` yields `styleLight: undefined`; selecting it blanks the map

- **Location:** `src/configs/MapConfig.ts:155-161`; consumed at
  `src/components/NyxmapCard.ts:226-233` / `:267-281`; produced by the editor at
  `src/components/NyxmapCardEditor.ts:138-140` and `src/components/NyxmapFormListEditor.ts:104-108`.
- **Severity:** Medium
- **What's wrong:** `MapStyleRaw.map_style` is typed as required but nothing validates it at
  runtime; `styleLight: s.map_style` propagates `undefined` straight into `LayerRegistry` and then
  into `map.setStyle(...)`. The visual editor makes this trivially reachable: clicking
  "+ Add style" emits `config-changed` immediately with `map_styles: [{ name: "" }]`.
- **Failure scenario:** In the card editor, the user clicks "+ Add style" and then (before
  filling in the URL) the layer switcher in the live preview lists an unnamed entry; selecting it
  calls `setStyle(undefined)`, which MapLibre treats as "remove the style" — the preview goes
  blank with no error. Duplicate `name` values are a milder variant: both map to the same
  `custom:<name>` registry id, so the second silently replaces the first.
- **Suggested fix:** Skip (or drop, with a `console.warn`) `map_styles` entries lacking a
  non-empty `name` and `map_style` in the `MapConfig` constructor, and guard
  `_onSelectBaseStyle`/`_resolveActiveStyleUrl` against a falsy resolved URL. De-duplicate names
  when building ids.
- **Confidence:** Confirmed.

---

## 14. Renaming an entity in the visual editor silently drops its YAML-only keys

- **Location:** `src/components/NyxmapCardEditor.ts:124-136` (`_entitiesChanged`).
- **Severity:** Low
- **What's wrong:** The previous raw entity is looked up by the *new* entity id
  (`previousByEntityId.get(id)`). On a rename the lookup misses and falls back to
  `{ entity: id }`, so `formDataToEntityRaw` spreads an empty previous — every key outside
  `ENTITY_SCHEMA_KEYS` is lost. (Matching by id rather than index is deliberate and correct for
  *reordering*; rename is the uncovered case.)
- **Failure scenario:** An entity configured in YAML with
  `geojson: {attribute: geo_shape, hide_marker: true}` and a rich `circle: {radius: 500, color:
  "#f00"}` is opened in the visual editor; the user corrects a typo in the entity id. Both blocks
  disappear from the saved config without any prompt.
- **Suggested fix:** Fall back to positional matching when the id lookup misses and the list
  length is unchanged, or thread a stable per-row key through `NyxmapFormListEditor`.
- **Confidence:** Confirmed.

---

## 15. Card-level fields can't be cleared through the visual editor

- **Location:** `src/editor/CardFormSchema.ts:96-107` (`formDataToCardConfig`), specifically
  `if (!(key in data)) continue;`.
- **Severity:** Low
- **What's wrong:** When `ha-form` reports a cleared field by omitting the key from
  `ev.detail.value` (rather than setting it to `undefined`), the loop skips it and the previous
  value is carried over from `{ ...previous }`.
- **Failure scenario:** A user deletes the contents of "Title" (or "Focus entity") in the visual
  editor. The field appears empty in the form, but the emitted config still carries the old
  `title:`, so the heading reappears on save. Only the `height` key is special-cased to clear
  (`parseHeight` returns `undefined` for `""`).
- **Suggested fix:** Delete keys from `next` that are present in `CARD_SCHEMA_KEYS` but absent
  from `data` (or whose value is `undefined`/`""`), rather than skipping them. Verify against the
  actual `ha-form` clear semantics for each selector type first — this is marked Plausible for
  that reason.
- **Confidence:** Plausible (our branch is confirmed; whether `ha-form` omits vs. nulls the key
  depends on the selector and was not verified against a live HA frontend).

---

## 16. Tile-layer overlay state is keyed by list index, so reordering re-targets it

- **Location:** `src/services/render/TileLayersRenderService.ts:22-24` (`sourceId`) and
  `:97-110`.
- **Severity:** Low
- **What's wrong:** Sources are keyed `tile-layer-${index}` / `wms-layer-${index}`, and the
  per-id `visibility` map (and the layer switcher's label "Tile layer N") follows the index, not
  the layer.
- **Failure scenario:** A card has two tile layers; the user hides "Tile layer 1" via the layer
  switcher, then edits the YAML to swap their order. `tile-layer-0` now holds the *other* layer's
  URL (applied via `setTiles`), but inherits the hidden visibility state — the wrong overlay is
  invisible, and the switcher labels are misleading.
- **Suggested fix:** Key on a stable identity — a hash of the resolved URL, or an optional
  user-supplied `name:` on the layer config (which would also give the switcher a real label).
- **Confidence:** Confirmed.

---

## 17. `colorFromString` can emit a negative HSL hue

- **Location:** `src/maplibre/MarkerFactory.ts:13-17`.
- **Severity:** Low
- **What's wrong:** The 32-bit hash `h` can be negative, and JS `%` keeps the sign, so the
  function returns e.g. `hsl(-257, 60%, 45%)`. Verified with real ids: `device_tracker.phone` →
  `-257`, `sensor.a` → `-235`.
- **Failure scenario:** The value is used both as a CSS custom property (fine — CSS Color 4
  treats hue as an angle taken modulo 360) and as a MapLibre `line-color`/`fill-color` paint
  value for default-coloured history trails and accuracy circles
  (`EntityHistoryManager.ts:37`, `CircleRenderService.ts:102`). Any MapLibre color parser that is
  stricter than the CSS spec would reject the value and fail `addLayer` — which, per finding 3,
  would take the whole `style.load` handler with it.
- **Suggested fix:** `((h % 360) + 360) % 360`. One line, removes the dependency on parser
  leniency entirely.
- **Confidence:** Confirmed that negative hues are produced; Plausible that any current parser
  rejects them (maplibre-gl 5.x uses a spec-compliant parser, so this is latent rather than
  active).

---

## 18. A descendant's `transitionend` can settle a marker animation early

- **Location:** `src/maplibre/MarkerAnimator.ts:47-55` (`onceSettled`).
- **Severity:** Low
- **What's wrong:** The listener is attached to the marker element without checking
  `e.target === el`. `transitionend` bubbles, and marker elements have children (the `<ha-icon>`
  added in `buildMarkerElement`).
- **Failure scenario:** An `<ha-icon>` whose internal SVG has any CSS transition (HA's own
  components frequently do) fires `transitionend` while the marker's converge animation is still
  running. The listener fires early, so `onDone()` — `marker.remove()` — runs mid-animation and
  the marker pops out of existence instead of shrinking into the cluster bubble.
- **Suggested fix:** `if (e.target !== el) return;` at the top of the listener (and drop
  `{ once: true }` in favour of explicit removal, since the guard means it may need to stay
  attached).
- **Confidence:** Plausible (the bubbling path is certain; whether an `ha-icon` in a real HA
  frontend actually transitions was not verified).

---

## 19. Test gaps around the invariants above

- **Location:** `src/components/NyxmapCard.test.ts`, `src/maplibre/StyleReattach.test.ts`,
  `src/models/EntityHistoryManager.test.ts`, `src/services/render/InitialViewRenderService.test.ts`.
- **Severity:** Low (but these are what let findings 1–4, 6 and 7 stand)
- **What's missing** (each verified absent by enumerating the `it(...)` titles in those files):
  - **No teardown test.** Nothing asserts anything about `disconnectedCallback` — not
    `map.remove()`, not observer re-observation. A test that disconnects and reconnects the
    element and asserts the resize path still works would catch findings 1 and 2.
  - **No `replayAll` isolation test.** `StyleReattach.test.ts` has four tests (replay, unregister,
    overwrite, clear) and none registers a throwing factory. One test asserting that a throwing
    factory doesn't prevent the others from replaying would pin finding 3.
  - **No mid-style-swap update test.** `NyxmapCard.test.ts` covers "does not render entities
    before style.load has fired" but never the *second* swap: `setConfig` → `setStyle` → push a
    new `hass` **before** re-firing `style.load`. The `FakeMap` never throws from `addSource`, so
    finding 4 is invisible to the suite; making the fake model `_loaded` would surface it.
  - **No history-failure test.** `EntityHistoryManager.test.ts` has eight tests, all with
    resolving fetchers. One rejecting fetcher among several would pin finding 7.
  - **No single-entity fit test.** `InitialViewRenderService.test.ts` asserts on `fitBounds`
    arguments for multi-point cases; a one-entity case asserting the padded bounds aren't
    degenerate would pin finding 6.
- **Confidence:** Confirmed.

---

## Verified-clean areas (checked, no defect found)

Recorded so a later pass doesn't re-derive them:

- **The style-swap invariant holds for every internal producer.** Every `addSource`/`addLayer`
  call site — `HistoryRenderService._upsert`, `CircleRenderService._upsert`,
  `GeoJsonRenderService._upsert`, `TileLayersRenderService._upsert`, `PluginHost._registerOverlay`
  — pairs the add with a `reattach.register(id, …)` whose factory re-adds the same
  source+layers and is guarded by `if (m.getSource(id)) return;`. Each `_remove` correctly calls
  `reattach.unregister(id)`. `ClusterRenderService` and `EntitiesRenderService` use HTML
  `maplibregl.Marker`s and correctly do *not* register (documented and true). The one caveat is
  isolation, covered in finding 3.
- **Config parsing is robust against missing/wrong-typed entity attributes.** Every position read
  goes through `Number.isFinite(...)` before use (`EntitiesRenderService:85`,
  `CircleRenderService:92`, `ClusterRenderService:147`, `InitialViewRenderService:20`).
  `resolveGeoJsonData` try/catches `JSON.parse` and type-checks. `resolveCircleRadius` type-checks
  every attribute. `HaHistoryService` handles a missing entity key and rows without `a`.
  `resolveTime` returns `null` rather than an Invalid Date. Malformed *card* YAML (e.g.
  `entities:` as a string, `map_styles:` as a scalar) throws from `setConfig`, which is the
  correct HA contract — it renders an error card.
- **`GeoJsonRenderService` click handlers** are correctly attached to the `Map` (not the style)
  and keyed by layer id, so they survive `setStyle()` without replay, as documented.
- **`EntitiesRenderService`'s** `for (const id of this.markers.keys()) … this.remove(id)` mutation
  during iteration is safe — `Map` iterators tolerate deletion of the current/unvisited entries.
- **`MarkerAnimator`'s** converge→emerge takeover is correct: `clearPending` cancels the pending
  `marker.remove()` before a re-emerging marker is re-added.
- **`PluginHost`** correctly isolates `setup()` throws, dedupes `injectStyle`, runs `activate()`
  exactly once across theme swaps, and injects into the shadow root (the load-bearing detail).
- **CI** (`.github/workflows/test.yml`) runs typecheck + lint + test + build on push and PR;
  `tsconfig.json` includes `src`, `test`, `dev`, and `vite.config.ts`. The only gap is that
  `npm run lint` targets `src` only, so `dev/` and `test/` are unlinted (cosmetic).
