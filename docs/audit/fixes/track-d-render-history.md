# Track D — render / marker / history defects

> **Superseded — historical record.** This is a point-in-time artifact of the
> v0.9.1 audit, kept for provenance. Much of it has since been fixed and parts
> of it are now simply wrong about the current tree (it predates the CI
> coverage gate, the whole-project lint, the removal of `loadMapLibreFromCdn`,
> and the `OverlaySource` extraction it recommends). Do **not** read it as a
> description of the project today — see `CHANGELOG.md` for what landed and
> `CLAUDE.md` for the current architecture and backlog.

**Branch:** `audit/wave-1-fixes` · **Baseline:** `34b7695` (wave 1, uncommitted tree) ·
**Date:** 2026-07-21

Scope: engineering audit §6.1 and §6.2; code review §7, §8, §9, §12, §16, §17, §18.
All ten findings were re-verified against the source before being fixed; all ten were
**accurate**. Nothing in this track was skipped as wrong or not worth fixing.

Files owned and touched by this track (nothing outside this list was edited):

```
src/components/NyxmapCard.ts                      (+ .test.ts)
src/configs/EntityConfig.ts
src/maplibre/MarkerAnimator.ts                    (+ .test.ts)
src/maplibre/MarkerFactory.ts                     (+ .test.ts)
src/models/EntityHistoryManager.ts                (+ .test.ts)
src/services/render/ClusterRenderService.ts       (+ .test.ts)
src/services/render/EntitiesRenderService.ts      (+ .test.ts)
src/services/render/TileLayersRenderService.ts    (+ .test.ts)
```

`src/editor/EntityFormSchema.ts` was in the ownership list but needed **no change** — see
§8 and §6.2 below (both were resolved by implementing the behaviour the editor already
advertised, so its schema is now honest as-is).

---

## Engineering §6.1 — raw NUL byte in `ClusterRenderService.ts`

**Verified.** `file` reported the module as `data`;
`LC_ALL=C grep -an '[^[:print:][:space:]]'` located **two** literal U+0000 bytes on one
line (the audit said one — `pairKey()` uses the separator twice, once per branch of the
ternary).

**Changed:** `src/services/render/ClusterRenderService.ts:57-59`. Both literal bytes
replaced with the `\u0000` escape:

```ts
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}
```

`\u0000` rather than the audit's suggested `\0` — same value, no octal-escape adjacency
rule to think about, and it reads as deliberate.

**Confirmed afterwards:**

- `file src/services/render/ClusterRenderService.ts` → `JavaScript source, Unicode text,
  UTF-8 text` (was `data`).
- Ripgrep searches it again: `git grep -c pairKey -- src/services/render/ClusterRenderService.ts`
  → `2`, and the repo's own Grep tool returns lines 57 and 261.
- `git diff` produces a **textual** diff. Note the one caveat: comparing the working tree
  against `HEAD` still prints `Bin 14198 -> 14208 bytes`, because git flags a diff binary
  if *either* side is — and the `HEAD` blob still contains the NUL. Verified this resolves
  the moment the fixed blob is on both sides: staging the file and then editing a line
  produced a normal `@@ -54,6 +54,7 @@` hunk. Nothing further to do; it clears on commit.

**Test:** `ClusterRenderService.test.ts` — new `describe("source hygiene")` block walks
every `.ts/.js/.json/.md/.css` file under `src/` and asserts none contains a raw NUL. Not
a behavioural test, but the failure mode is invisible to every normal tool and trivial to
reintroduce by paste — it recurred *once during this very session*, in an edit to
`MarkerFactory.ts` (caught and stripped before commit; that file is clean and covered by
the same guard).

**Deliberately not done:** the audit's optional `.gitattributes` `*.ts text` entry — that
file is repo-root, outside this track's ownership, and the unit guard above catches the
same thing at a point where it's cheaper to fix.

---

## CR §17 — `colorFromString` can emit a negative HSL hue

**Verified.** `device_tracker.phone` → `hsl(-257, 60%, 45%)`.

**Changed:** `src/maplibre/MarkerFactory.ts:13-22` — `h % 360` → `((h % 360) + 360) % 360`,
with a comment recording *why* it matters: the same string is used as a MapLibre
`line-color` / `fill-color` paint value (`EntityHistoryManager`, `CircleRenderService`),
where the parser is spec-compliant, not just as a CSS custom property where a negative
hue is legal.

**Test:** `MarkerFactory.test.ts` → `colorFromString` › `it.each([...])
"never emits a negative hue for %s"`, over five real-shaped entity ids including both the
audit's confirmed offenders.

---

## CR §18 — a descendant's `transitionend` settles a marker animation early

**Verified.** The listener was attached with no `e.target` check, `transitionend` bubbles,
and `buildMarkerElement` appends an `<ha-icon>` child.

**Changed:** `src/maplibre/MarkerAnimator.ts:45-70` (`onceSettled`). Split into `settle()`
(used by the fallback timer) and a DOM `listener` that returns early unless
`e.target === el`. `{ once: true }` dropped — the listener now has to survive foreign
events, so it's removed explicitly by `clearPending()` instead. `AnimState.listener` is
retyped `(e: Event) => void`.

**Tests:** `MarkerAnimator.test.ts` — three new cases: a bubbling `transitionend` from an
`<ha-icon>` child does *not* fire `onDone` (and the element's own one still does); the
fallback timer still settles after a descendant event was ignored; and the listener is
gone after settling, so a later descendant event can't re-fire it.

---

## CR §16 — tile-layer overlay state keyed by list index

**Verified.** `sourceId(kind, index)` produced `tile-layer-${i}`, and the `visibility`
map, the `StyleReattach` factory and the `LayerRegistry` entry were all keyed on it.

**Changed:** `src/services/render/TileLayersRenderService.ts`

- `identityToken()` (`:33-45`) — `options.name` (slugified) when supplied, else a base36
  djb2-style hash of the layer's **pre-template-resolution** `url`, so identity survives
  both a reorder *and* a `{{ states(...) }}` url whose resolved value changes.
- `sourceId(kind, token)` (`:47-49`) keeps the `tile-layer-` / `wms-layer-` **prefixes
  verbatim** — they are part of the reserved-id namespace documented to plugin authors
  (`types/nyxmap-plugin.d.ts:66`, `PluginHost.RESERVED_OVERLAY_ID_PREFIXES`), which this
  track doesn't own and must not invalidate.
- `update()` (`:130-158`) disambiguates two layers sharing a token by appending `-1`, `-2`
  … (positional, but for genuinely interchangeable layers).
- `layerLabel()` (`:88-97`) — the switcher label uses `options.name` when given
  (`"Rain Radar"` beats `"Tile layer 2"`), else the positional fallback. The label
  deliberately *does* still track position, so the switcher reads in config order while
  each entry's visibility state stays welded to its own layer.

**YAML shape:** the name goes under `options:`, not at the top level:

```yaml
tile_layers:
  - url: https://…/{z}/{x}/{y}.png
    options:
      name: Rain Radar
```

**Blocker (documented, not worked around):** a top-level `name:` would be nicer, but
`LayerConfig` only copies `attribution` plus `options` onto itself, so supporting it means
editing `src/configs/LayerConfig.ts` — outside this track's ownership. `options.name` needs
no config-parser change and is forward-compatible with adding the top-level alias later.
It is also not documented in README (sibling-owned) — flag for whoever owns docs.

**Tests:** `TileLayersRenderService.test.ts` → new
`describe("stable per-layer identity (ids no longer follow list position)")`:
ids survive a reorder with no source torn down and the *hidden* flag replaying onto the
right layer (asserted through `StyleReattach.replayAll` onto a fresh map, which is what
the old index keying got wrong); labels follow position while ids don't; `options.name`
drives both id and label; a templated url resolving to a new value keeps the id and takes
the `setTiles` path; two same-url layers get distinct ids. Existing tests were updated for
the new ids (`NyxmapCard.test.ts` layer-ordering test now uses `tile-layer-base`).

---

## CR §9 — marker DOM built once, never rebuilt

**Verified.** `buildMarkerElement` was only called in the `if (!tracked)` branch.

**Changed:**

- `src/maplibre/MarkerFactory.ts:31-71` — extracted `applyMarkerVisual(el, cfg, state)`;
  `buildMarkerElement` is now a thin `createElement` + `applyMarkerVisual`. Same
  build/apply split (and same rationale) as the existing
  `buildClusterBubbleElement` / `applyClusterBubbleVisual` pair in the same module.
  It redraws the element **in place** — resets the three modifier classes,
  `replaceChildren()`, clears `background-image` — and deliberately leaves the
  `nyxmap-anim-out` class and the `--nyxmap-anim-dx/dy` custom properties alone, so a
  redraw landing mid-animation doesn't cancel it.
- `src/maplibre/MarkerFactory.ts:73-95` — `markerVisualKey(cfg, state)`: every input
  `applyMarkerVisual` reads, joined on `\u0000`. The entity's `state` is included **only**
  when `display === "state"`, so an ordinary `home`/`not_home` flip doesn't churn the DOM.
- `src/services/render/EntitiesRenderService.ts:45-48, 99-121` — `TrackedMarker` gains
  `visualKey`; the update path re-applies the visual only when the key differs.

Mutating the node rather than swapping in a fresh one is the load-bearing choice: it keeps
the `click` listener, the `MarkerAnimator` `WeakMap` entry, and any in-flight animation
class attached to the element MapLibre already owns.

**Tests:** `EntitiesRenderService.test.ts` → `describe("marker DOM stays current")` —
a rotated `entity_picture` token redraws on the *same* node; the tap handler still fires
after a redraw; a position-only update leaves the node untouched; plus the
`z_index_offset` case below. `MarkerFactory.test.ts` covers `applyMarkerVisual`
(picture→icon swap clears prior state, animation state preserved, no accumulating
`<ha-icon>` children) and `markerVisualKey` (changes on token/icon/rename; ignores a state
change unless `display: "state"`).

---

## CR §8 — `display: "state"` offered but never rendered

**Decision: implement, not remove.** Upstream `ha-map-card` renders the state value for
this mode, the key already round-trips through `EntityConfig` and the editor dropdown, and
removing it would break any migrated dashboard that already sets it. Implementing is also
the smaller diff.

**Changed:** `src/maplibre/MarkerFactory.ts:41-49` — a `display === "state"` branch at the
**head** of the fallback chain (so it outranks both picture and icon), rendering
`stateObj?.state ?? label ?? initials(id)`.

It reuses the `nyxmap-marker--initials` class for its solid-disc + centred-text treatment
rather than introducing a `nyxmap-marker--state` class, because the stylesheet
(`NyxmapCard.styles.ts`) is outside this track's ownership. **Consequence to be aware of:**
a long state value (`"not_home"`, `"unavailable"`) is drawn in a 48px circle at the
initials font size and will overflow/clip. A dedicated class with `white-space: nowrap` and
a pill shape would be the proper treatment — flagged for whoever owns the stylesheet.

`src/editor/EntityFormSchema.ts:46` needed no change: the dropdown already offered
`"state"`, and it now does something.

**Tests:** `MarkerFactory.test.ts` → `describe("display: 'state'")` — renders the state
value and outranks a configured picture *and* icon; falls back to label, then initials,
when there is no state object.

---

## CR §7 — one failing history fetch discards every entity's trail, permanently

**Verified.** `Promise.all` over per-entity fetches, a `.then` with no `.catch` at the call
site, and `_historyCatchUpDone = true` set *before* awaiting.

**Changed:**

- `src/models/EntityHistoryManager.ts:44-51` — the `await fetchPath(...)` is wrapped in a
  per-entity try/catch that `console.warn`s and returns, so the per-entity task never
  rejects and the aggregate always resolves. (Equivalent to the audit's `allSettled`
  suggestion, but keeps the existing `Promise.all` shape and lets each failure name its own
  entity in the log.) One bad entity now degrades to "no trail for that entity".
- `src/components/NyxmapCard.ts:793-826` (`_refreshHistory`) — the promise chain now
  terminates in `.catch` (it had none), and `_historyCatchUpDone` moved into `.finally`,
  i.e. it is latched on **settle** rather than before awaiting.

**Tests:** `EntityHistoryManager.test.ts` → `describe("per-entity failure isolation")` —
one rejecting fetcher among three leaves the other two trails intact; all three failing
still resolves to an empty map rather than rejecting. `NyxmapCard.test.ts` →
`"survives a rejecting history fetch without an unhandled rejection, and retries later"`.

---

## CR §12 — history fetched once per style load, never refreshed

**Verified.** Only trigger was another `style.load`.

**Changed:** `src/components/NyxmapCard.ts`

- `HISTORY_REFRESH_MS = 60_000` (`:43`) with a comment on why an interval rather than a
  re-fetch per `hass` object (HA replaces `hass` on any state change anywhere, which would
  mean many history round-trips per second).
- `_syncHistoryTimer()` (`:828-837`) starts/stops the poll to match config, called from
  `_refreshHistory()`; `_hasHistoryConfigured()` (`:840-844`) mirrors
  `EntityHistoryManager`'s own opt-in rule, so a card with no `history_start` anywhere
  never installs a timer at all.
- `_historyInFlight` (`:82`) — an in-flight guard, so a slow fetch can't have interval
  ticks stack behind it.
- `_historyGeneration` (`:81`, bumped `:798`, checked `:805` and `:816`) — the
  abort/generation token the audit asked for. A response whose token is stale is dropped.
  This also closes two pre-existing ordering hazards in this chain that CR §4 called out
  but wave 1 only fixed on the `updated()` side: the `.then` additionally requires
  `this._ready`, so a response landing mid-`setStyle()` can't call `addSource` on an
  unloaded style, and a response landing after teardown can't touch a destroyed map.

**Teardown (explicitly per the brief):** `_teardown()` (`:212-221`) — read before writing,
as instructed — now clears the interval, bumps `_historyGeneration` and resets
`_historyInFlight`, *before* `this._map?.remove()`. Placed there rather than in
`disconnectedCallback()` on purpose: wave 1 made `disconnectedCallback` defer by a
macrotask so a benign Lit re-parent doesn't destroy the map, and a re-parented card's map
is still live and should keep polling. `_teardown()` is the real-removal path.

**Tests:** `NyxmapCard.test.ts` → `describe("history refresh")` (fake timers): re-fetches
at 60s intervals; installs no timer when nothing configures history; clears the timer on
teardown so a destroyed map is never touched again; does not stack overlapping fetches
(non-resolving fetch across three ticks → exactly one call); the §7 retry case; and a
response that lost the race to a newer request is discarded without throwing.

**Deliberately not done:** the interval is a module constant, not a config key. Adding
`history_refresh_interval:` means editing `src/configs/MapConfig.ts` and
`src/editor/CardFormSchema.ts`, both sibling-owned. Also unaddressed (and still correctly
in the CLAUDE.md backlog): `energy-date-selection` subscription, and re-fetching when a
tracked entity's `last_updated` advances — the interval is the coarse fix the audit
recommended first.

---

## Engineering §6.2 — `z_index_offset` parsed and editable but consumed by nothing

**Decision: implement, not remove.** Same reasoning as §8 — it's an upstream key that
already round-trips and is already a labelled control in the visual editor
(`NyxmapCardEditor.ts:48`), so removing it would silently discard existing configs.

**Changed:**

- `src/maplibre/MarkerFactory.ts:105-112` — `wrapAnimatedMarker(inner, zIndex?)` sets
  `wrapper.style.zIndex`. The **wrapper**, not the visual node: MapLibre gives each marker
  its own absolutely-positioned element in a shared container, so cross-marker stacking is
  decided there. Confirmed MapLibre never writes `style.zIndex` on a marker element itself
  (`grep -n zIndex node_modules/maplibre-gl/dist/maplibre-gl-dev.js` → no hits), so there's
  nothing to fight over — the same class of check that produced the existing comment about
  `style.transform` being rewritten every tick.
- `src/services/render/EntitiesRenderService.ts:104` — passes `ent.zIndexOffset`.
- `src/configs/EntityConfig.ts:26-35` — the class doc-comment claimed only "display/marker
  fields are wired to rendering in Phase 1"; replaced with an accurate note that `display`
  and `zIndexOffset` are now both consumed by `MarkerFactory`. (Also dropped a dangling
  "see CLAUDE.md §5" pointer, which is on Track C's cross-reference list.)

`EntityConfig` defaults `zIndexOffset` to `1`, so every marker now carries `z-index: 1` —
uniform, therefore ordering is unchanged for anyone who never sets the key.

**Tests:** `MarkerFactory.test.ts` → `wrapAnimatedMarker` gets a no-z-index case and a
`z_index_offset: 7` case. `EntitiesRenderService.test.ts` →
`"applies z_index_offset to the marker's positioning wrapper"`, asserting it lands on the
`.nyxmap-marker-anchor` parent.

**Blocker:** `z_index_offset` is still absent from README's Entity options table
(README is sibling-owned) — it is now implemented but undocumented. Flag for docs.

---

## Summary of deliberate non-actions

| Item | Why not |
| --- | --- |
| `.gitattributes` `*.ts text` (eng §6.1 optional) | repo-root file, outside ownership; the new unit guard covers the same risk |
| Top-level `name:` on a tile/WMS layer (CR §16) | needs `src/configs/LayerConfig.ts`, outside ownership; `options.name` works today and is forward-compatible |
| Dedicated `.nyxmap-marker--state` style (CR §8) | needs `NyxmapCard.styles.ts`, outside ownership; long state values will clip in the reused initials disc |
| `history_refresh_interval:` config key (CR §12) | needs `MapConfig.ts` + `CardFormSchema.ts`, both sibling-owned |
| README rows for `options.name`, `display: state`, `z_index_offset` | README is sibling-owned |
| `energy-date-selection` / `last_updated`-driven history refresh (CR §12) | remains correctly listed in CLAUDE.md's backlog; the interval is the fix the audit asked for first |

---

## Verbatim tail of the final gate runs

Run on the settled tree (which also contained the sibling track's in-flight edits — all
green regardless). `npm run test:coverage` was not run, per the brief. Nothing committed.

```
$ npm run typecheck

> ha-nyxmap-card@0.9.1 typecheck
> tsc --noEmit

$ npm run lint

> ha-nyxmap-card@0.9.1 lint
> eslint src

$ npm test

 ✓ src/editor/MapStyleFormSchema.test.ts (2 tests) 9ms
 ✓ src/models/EntityHistory.test.ts (2 tests) 4ms

 Test Files  33 passed (33)
      Tests  382 passed (382)
   Start at  13:20:11
   Duration  8.64s (transform 2.12s, setup 539ms, collect 4.54s, tests 2.63s, environment 24.20s, prepare 10.49s)
```

`npm run build` also succeeds (`✓ 67 modules transformed`, `dist/nyxmap-card.js 1,705.96
kB │ gzip: 369.80 kB`).

Baseline was 33 files / **332** tests; this track adds **50**, for 382. No pre-existing
test was deleted; the only pre-existing edits were the tile-layer id strings in
`TileLayersRenderService.test.ts` and `NyxmapCard.test.ts` (§16) and two history fixtures
lengthened to two points so a trail actually renders.
