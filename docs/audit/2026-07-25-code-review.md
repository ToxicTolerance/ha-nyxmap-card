# Code review — ha-nyxmap-card

**Date:** 2026-07-25 · **Version reviewed:** v0.10.3 (`77e613e`) · **Branch:** `claude/code-review-documentation-1uwejg`

A read-only engineering review of the whole `src/` tree, run the way a debugger
would: read the code, form a hypothesis about a failure mode, then try to make
it happen. **Nothing in `src/` was changed by this pass** — this document is the
deliverable. Each finding below states how it was verified and what the fix
would be.

## Baseline: the gate is green

Reproduced locally on a clean `npm ci` before reviewing anything, so every
finding below is a defect the existing gate does *not* catch:

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings 0`) | pass, 0 warnings |
| `npm test` | **479 passed / 479**, 37 files |
| coverage (per-file floor 70%) | 99% stmts · 92% branch · 97.5% funcs — no file below floor |

That is a genuinely strong baseline. The findings are concentrated where the
gate structurally can't reach: protocol correctness against a third-party server
(F1), a cross-module state handshake that no single unit test owns (F2), and
per-frame cost, which nothing asserts on (F3).

---

## Findings

Ranked by severity. "Verified" means the failure was actually reproduced or the
wrong value was printed, not just reasoned about.

| # | Severity | Area | Summary |
|---|---|---|---|
| F1 | **High** | `TileLayersRenderService` | WMS 1.1.1 requests send `CRS=` instead of `SRS=` — every WMS overlay on the default version is rejected by the server |
| F2 | **High** | `NyxmapCard` / `OverlaySource` | An overlay hidden in the layer switcher comes back **visible** after it is removed and re-registered, while its checkbox still reads unchecked |
| F3 | Medium | `NyxmapCard`, `LayerSwitcherControl`, `CircleRenderService` | Three per-`hass`-tick costs: a forced style read, 3× forced layout, and a full geodesic-circle rebuild + `setData` per entity |
| F4 | Low | `EntitiesRenderService` | `update()` builds and returns a `LngLatBounds` that no caller reads |
| F5 | Low | `EntityHistory` / `HistoryRenderService` | A dots-only trail with a single sample is dropped, though one dot is drawable |
| F6 | Low | `LayerSwitcherControl` | `ResizeObserver` is never attached if `offsetParent` is null at first render, and nothing retries |
| F7 | Low | `NyxmapCard`, `PluginHost` | `_overlayVisibility` / `_overlayVisible` are never pruned when an overlay goes away |
| F8 | Nit | `CLAUDE.md` | Says "36 test files today"; there are 37 |

---

### F1 — WMS 1.1.1 requests send `CRS` instead of `SRS` · **High**

**Where:** `src/services/render/TileLayersRenderService.ts:65` and `:72`

```ts
params.set("VERSION", param(options.version, "1.1.1"));
...
params.set("CRS", "EPSG:3857");
```

**What's wrong.** In WMS **1.1.1** the GetMap coordinate-reference parameter is
named `SRS`. `CRS` was introduced in **1.3.0**. The builder hardcodes `CRS`
unconditionally while defaulting `VERSION` to `1.1.1`, so the default
configuration emits a request that names a parameter the declared version does
not have, and omits the one it requires.

**Verified.** The URL the code produces for the README's own example
(`README.md:213`) is:

```
https://…/n0r.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=nexrad-n0r
  &STYLES=&FORMAT=image%2Fpng&TRANSPARENT=true&WIDTH=256&HEIGHT=256
  &CRS=EPSG%3A3857&BBOX={bbox-epsg-3857}
```

No `SRS`. MapServer and GeoServer both answer a 1.1.1 GetMap with no `SRS` with
a `ServiceException` XML document rather than an image.

**Failure the user sees.** The raster overlay is simply blank. MapLibre reports
a source-load failure on the map's `error` event, which this card doesn't
surface, so there is no card-level error, no console message from us, and
nothing in the layer switcher to suggest the layer is broken rather than empty —
the only evidence is XML in the network tab. `version: 1.3.0` happens to work
today, which makes the bug look like "that one server is broken".

**Not caught because** no test in `TileLayersRenderService.test.ts` exercises
`options.version` at all, and no test asserts on the CRS/SRS parameter (grep for
`SRS` across `src/` returns nothing).

**Fix.** Select the parameter name from the version, which is exactly what
Leaflet's `L.TileLayer.WMS` does (`version >= '1.3' ? 'crs' : 'srs'`) — and
therefore what upstream `ha-map-card` users' existing WMS configs assume:

```ts
const version = param(options.version, "1.1.1");
params.set("VERSION", version);
params.set(version >= "1.3" ? "CRS" : "SRS", "EPSG:3857");
```

Worth a parameterized test over `undefined | "1.1.1" | "1.3.0"`.

---

### F2 — a hidden overlay returns visible while the switcher says hidden · **High**

**Where:** `src/components/NyxmapCard.ts:501-521` (`_syncOverlayVisibility`) ×
`src/services/render/OverlaySource.ts:269-281` (`remove`)

**What's wrong.** Overlay visibility is tracked in three places that must agree:

| State | Owner | Cleared when the overlay is removed? |
|---|---|---|
| `_overlayVisibility` — the user's intent, drives the checkbox | `NyxmapCard` | no (deliberate) |
| `_appliedOverlayVisibility` — what was last pushed to the services | `NyxmapCard` | **no** |
| `OverlaySource.visibility` — what a reattach replay rebuilds at | the service | **yes** (`remove()` does `this.visibility.delete(id)`) |

When an overlay is removed, the service forgets it was hidden but the card still
believes it pushed "hidden". So when the overlay comes back, `build()` re-adds
its layers with `visibility: "visible"`, while `_syncOverlayVisibility()`'s
`if ((this._appliedOverlayVisibility.get(id) ?? true) === visible) continue;`
sees desired `false` == applied `false` and **skips**. The layer is visible; the
checkbox is unchecked. The user has to toggle twice to re-hide it.

This is the same defect class the `_teardown()` comment at `NyxmapCard.ts:265-273`
was written to fix — `_appliedOverlayVisibility.clear()` handles the *teardown*
path, but not the far more common per-overlay removal path.

**Verified — reproduced.** A throwaway jsdom test drove the real card: config
two entities with `gps_accuracy`, fire `style.load`, toggle `circle-person.a`
off in the switcher, drop `person.a` from config, add it back. Result:

```
layers re-added for circle-person.a [["circle-person.a-fill","visible"],
                                     ["circle-person.a-line","visible"]]
_overlayVisibility.get("circle-person.a") === false
```

**Reachable without any config edit.** A config edit is just the easiest way to
drive it in a test. In normal use:

- **Accuracy circles + clustering (default-on together).**
  `CircleRenderService.update()` skips any entity in the `absorbed` set
  (`CircleRenderService.ts:113`) and `reconcile(seen)` therefore *removes* that
  circle's overlay. Hide a circle in the switcher, zoom out until its entity is
  absorbed into a bubble, zoom back in → the circle returns visible with its box
  unchecked.
- **History trails.** `HistoryRenderService.update()` skips `!history.hasPath`
  and reconciles the rest away, so any refresh that returns fewer than two
  points (recorder purge, a tracker that went unavailable) removes the trail;
  the next good refresh brings it back visible.

**Fix.** One place, in `_syncOverlayVisibility()`: drop applied entries for ids
the registry no longer knows about, before the reconcile loop.

```ts
for (const id of this._appliedOverlayVisibility.keys()) {
  if (!this._layerRegistry.getOverlays().has(id)) this._appliedOverlayVisibility.delete(id);
}
```

This is safe: registry membership tracks overlay existence exactly
(`OverlaySource.upsert` re-registers on every update, `remove()` unregisters),
and the method already returns early while `!this._ready`, so a style swap can't
be mistaken for a removal. A regression test should assert the re-added layers
carry `visibility: "none"`.

---

### F3 — three per-`hass`-tick costs · Medium

Home Assistant replaces the whole `hass` object on **every state change anywhere
in the instance** — the codebase says so itself (`OverlaySource.ts:107-113`,
`InitialViewRenderService.ts:110-116`) and builds guards around it. Three paths
were not given those guards.

**(a) A forced style read on every update.** `NyxmapCard.updated()` (`:303-306`)
calls `getComputedStyle(this).getPropertyValue("--card-background-color")` every
time the card updates, i.e. many times a second on a busy install, per card.
`getComputedStyle` flushes pending style. The value it reads changes only when
the HA theme changes.
*Fix:* re-read only when something that can change it changed (`changed.has("_config")`,
first update, or a theme signal) and cache the last result.

**(b) 3× forced layout on every update, when `layer_switcher: true`.**
`NyxmapCard.render()` passes `.baseStyles=${this._baseStyleItems()}` and
`.overlays=${this._overlayItems()}` — both build a **fresh array each render**,
so Lit's default `!==` check always reports a change and the switcher always
re-renders. `LayerSwitcherControl.updated()` (`:108-113`) then unconditionally
calls `_measure()`, which does three `getBoundingClientRect()` reads
(`:118-134`). That is a forced synchronous layout per `hass` tick, purely to
re-derive an offset that only changes when the control column's height changes.
*Fix:* either memoize the two item arrays (rebuild only when the registry or
`_overlayVisibility` actually changed) or gate `_measure()` on the inputs that
can move it. The `_measure()` body already no-ops the style write when the
numbers match — it's the three rect reads that cost.

**(c) A full geodesic circle rebuilt per entity per tick.**
`CircleRenderService.build()` calls `circlePolygonCoordinates()` →
`@turf/circle` with 64 steps (`util/geo.ts:79-85`) for every entity on every
`update()`, and `OverlaySource.upsert` then pushes it through `setData()`. This
is precisely the cost the `dataKey` guard was added for in the v0.10.2 wave
(`OverlaySource.ts:103-115`), but `CircleRenderService.build()` declares no
`dataKey`, so the `setData()` — and MapLibre's re-tessellation behind it — runs
unconditionally.
*Note for whoever fixes this:* a `dataKey` alone is only half the fix. `build()`
runs **before** the `dataKey` comparison in `upsert()` (`OverlaySource.ts:194-214`),
so the turf call still happens; skipping it needs the polygon memoized on
`(center, radiusMeters)` inside `CircleRenderService`. The `dataKey` skips the
`setData` and the GPU work, which is the larger half.

---

### F4 — `EntitiesRenderService.update()` returns dead work · Low

**Where:** `src/services/render/EntitiesRenderService.ts:76-157`

`update()` constructs `new this.gl.LngLatBounds()`, calls `bounds.extend()` once
per positioned entity, and returns it. The only production call site discards
the result (`NyxmapCard.ts:886`), and auto-fit is served entirely by
`InitialViewRenderService`, which derives its own bounds from config + hass
(`_boundsOf`). The return value is never read anywhere outside tests.

The cost isn't the allocation — it's that `MapLibreGlLike` has to declare a
`LngLatBounds` constructor (`:31`) that exists *only* to feed this dead path,
which every fake and every future caller must then implement. Removing the
return and the interface member narrows the seam.

Worth confirming intent first: this may be a deliberate hook for a not-yet-built
caller, in which case a one-line comment saying so is the cheaper fix.

---

### F5 — a dots-only trail with one sample renders nothing · Low

**Where:** `src/models/EntityHistory.ts:10-13`, `src/services/render/HistoryRenderService.ts:121-125`

`hasPath` is documented as "a LineString needs at least two points to draw
anything" — correct for lines, but `HistoryRenderService.update()` uses it as
the gate *before* considering whether lines are even enabled. With
`history_show_lines: false` + `history_show_dots: true`, a single recorded
position is perfectly drawable as one dot, and is dropped instead. The overlay
also never appears in the layer switcher, so it reads as "history is broken for
this entity".

*Fix:* make the minimum depend on what's being drawn — `showLines ? 2 : 1` —
or gate on `coordinates.length >= (showLines ? 2 : 1)` at the call site.

---

### F6 — the switcher's `ResizeObserver` can never attach · Low

**Where:** `src/components/LayerSwitcherControl.ts:100-106`

```ts
private _observeParent(): void {
  this._measure();
  const parent = this.offsetParent as HTMLElement | null;
  if (!parent || this._resizeObserver) return;   // ← no retry
  ...
}
```

`offsetParent` is `null` whenever the element or an ancestor is `display: none`
— an HA conditional card, or a dashboard tab that hasn't been shown yet. The
only callers are `firstUpdated()` (runs once) and `connectedCallback()` (only on
a re-parent), so a switcher first rendered while hidden loses resize tracking
for the life of the page.

Impact is genuinely small because `updated()` calls `_measure()` on every update
anyway (which is F3(b)), so the offsets stay roughly correct in practice — the
gap is a pure window resize with no other update in flight. Noted mainly because
fixing F3(b) by gating `updated()`'s `_measure()` would *remove* that accidental
safety net and promote this to a visible bug. **Fix these two together.**

---

### F7 — visibility maps are never pruned · Low

`NyxmapCard._overlayVisibility` (`:113`) and `PluginHost._overlayVisible`
(`:75`) accumulate an entry per overlay id ever touched and never drop one.
Bounded by user clicks and plugin registrations, so it is tidiness rather than a
leak — but it is the same map F2's fix touches, and keeping the user's intent
for an overlay that no longer exists is what makes F2 possible to get wrong.
Retaining `_overlayVisibility` across a teardown is deliberate and documented
(`:265-273`); retaining it forever for a deleted entity is not.

---

### F8 — doc drift · Nit

`CLAUDE.md:148` says "36 test files today"; `find src -name '*.test.ts'` returns
**37**. The neighbouring "~10 files that need a DOM" is accurate (exactly 10).

---

## What was checked and found sound

Recorded so a later reviewer doesn't re-derive it:

- **Theme-swap invariant.** Every source/layer-backed overlay registers with
  `StyleReattach`; the four services go through `OverlaySource.upsert`, plugins
  through the same `registerOverlayLifecycle`. `ClusterRenderService`'s
  deliberate non-participation is correct — its bubbles are HTML markers.
- **`StyleReattach.replayAll`** snapshots before iterating and isolates each
  factory. Both protections are load-bearing and correct.
- **`PluginHost` id-collision guard.** The static prefix set, the exact-id set
  and the dynamic registry check are each necessary; the reserved lists are
  derived from `OverlayIds` so they cannot drift. Rejection is all-or-nothing.
- **`HistoryRefreshController`.** The generation guard, the in-flight coalescing
  (`refreshRequested`), and latching `catchUpDone` on *settle* rather than on
  dispatch are all correct. `generation` is only bumped when not in flight or
  from `stop()`, so the `finally` guard cannot strand `inFlight`.
- **`MarkerAnimator`.** `clearPending` cancels the timer, the listener **and**
  the emerge `raf`; the `e.target !== el` guard against bubbling `transitionend`
  from an `<ha-icon>` child is correct and necessary.
- **`colorFromString`** normalises the negative modulus — the hue really is
  fed to a spec-compliant MapLibre paint parser, so this matters.
- **`HaUrlResolveService`** percent-encodes the substituted entity state; a
  spoofed state cannot inject path or query fragments into a tile URL.
- **Config parse tolerance.** Dropping half-typed `entities` / `map_styles` /
  `tile_layers` entries rather than throwing is right — `setConfig` runs per
  keystroke in the visual editor and a throw becomes an HA error card.
- **`boundsFromLngLatBounds` / `MapSeamConformance`.** The adapter and the
  compile-time seam guard correctly close the `focus_follow: "contains"` hole.
- **`padBounds` zero-area guard** in `InitialViewRenderService._fit` correctly
  handles the single-entity case that `buildStubConfig` produces.

---

## Suggested order of work

1. **F1** — one-line protocol fix, user-visible, no design question. Add a
   version-parameterized test.
2. **F2** — one-line fix in `_syncOverlayVisibility`, plus the regression test.
   Fold F7's pruning in while there.
3. **F3(b) + F6 together** — they touch the same method and fixing one alone
   makes the other worse.
4. **F3(a)**, **F3(c)**, **F5**, **F4**, **F8** — independent, any order.
