# Track E — visual editor + documentation follow-ups

- **Baseline:** `34b7695` ("Audit wave 1: card lifecycle, extension-point isolation, doc
  accuracy"), branch `audit/wave-1-fixes`. Verified green before starting: `npm run typecheck`
  clean, `npm run lint` clean, `npm test` **33 files / 332 tests passing**.
- **Findings addressed:** code-review §13, §14, §15; the three documentation follow-ups flagged in
  `track-c-docs.md` §5 (items 1 and 2, plus the suggested `[Unreleased]` CHANGELOG entry).
- **Files changed:** `src/configs/MapConfig.ts` (+ `.test.ts`), `src/editor/CardFormSchema.ts`
  (+ `.test.ts`), `src/components/NyxmapCardEditor.ts` (+ `.test.ts`), `CLAUDE.md`, `README.md`,
  `CHANGELOG.md`, and this document. `src/editor/MapStyleFormSchema.ts` and
  `src/components/NyxmapFormListEditor.ts` were in scope but needed no change (see §5). No commit
  was made.

All three findings were re-verified against the source before being fixed. All three were **real**;
none needed to be corrected the way wave 1 corrected three of the audit's claims. §15 was filed as
*Plausible* and stays partly so — see its "residual uncertainty" note.

---

## CR §13 — a `map_styles` entry without `map_style` blanks the map

**Verified first.** At `34b7695`, `MapConfig.ts:155-161` was a bare `.map()`:
`styleLight: s.map_style`. `MapStyleRaw.map_style` is typed required but nothing checked it at
runtime, and the value flows to `NyxmapCard._syncBaseStyles` (`NyxmapCard.ts:436-445`,
`registerBaseStyle` with `styleLight: s.styleLight`) and from there into `map.setStyle(...)`.
Reachability confirmed in `NyxmapCardEditor.render` (`:109`): the styles list editor's
`newItemDefaults` is `() => ({ name: "" })`, and `NyxmapFormListEditor._add` (`:104-108`) emits
`items-changed` immediately, so clicking "+ Add style" writes `map_styles: [{ name: "" }]` into the
config before a single character is typed. The duplicate-`name` variant is real too: ids are built
as `custom:${s.name}` (`NyxmapCard.ts:437`) and `registerBaseStyle` is a plain `Map.set`, so a
repeated name silently replaces the earlier entry.

**Changed.** `src/configs/MapConfig.ts:39-79` — new module-private `parseMapStyles()`, called from
the constructor (`:197`, replacing the inline `.map()`). It drops an entry when, after trimming,
it has no `name`, or no `map_style`, or a `name` already used earlier in the list (first wins), and
tolerates a `null`/`undefined` hole. Surviving entries store trimmed values, and `styleDark` still
falls back to `styleLight`.

**Why here and not at the consumer.** `_resolveActiveStyleUrl`/`_onSelectBaseStyle` live in
`NyxmapCard.ts`, which this track may not edit. Validating at the parse boundary is also the better
place: the invalid entry never reaches the registry, the switcher, or the initial-style match at
`NyxmapCard.ts:469`, so there is no second code path to keep guarded. First-wins de-duplication was
chosen so `config.mapStyles` agrees with what `LayerRegistry` actually ends up holding (one entry
per id) instead of listing two entries that resolve to one.

**Deliberately silent.** Dropped entries are not `console.warn`ed, against the audit's "(or drop,
with a `console.warn`)". `MapConfig` is re-parsed on every `setConfig`, i.e. on every keystroke in
HA's card editor, where a half-typed entry is the normal intermediate state — a warning there is a
stream of noise for the exact case that is *not* a mistake. The feedback is that the entry doesn't
appear in the switcher until it is complete. Documented in the function's doc comment and in
README's `map_styles` row.

**Tests** (`src/configs/MapConfig.test.ts`, new `describe("map_styles validation")`, 7 cases):
drops an entry with no `map_style`; drops the editor's freshly-added `{ name: "" }` row; drops a
whitespace-only `name`; drops a whitespace-only `map_style`; de-duplicates by name keeping the
first; trims name/URLs; ignores a `null` hole. The two pre-existing `map_styles` tests still pass
unchanged.

---

## CR §14 — renaming an entity in the visual editor drops its YAML-only keys

**Verified first.** `NyxmapCardEditor._entitiesChanged` (`:124-136` at `34b7695`) built
`previousByEntityId` from the old config and looked each edited row up by its **new** entity id.
`formDataToEntityRaw(data, previous)` (`EntityFormSchema.ts:106-108`) starts from
`{ ...prevRaw }` and only overwrites `ENTITY_SCHEMA_KEYS`, so an empty `{ entity: id }` fallback is
exactly a wipe of every other key — `geojson`, a rich `circle:` object, and anything hand-authored.
On a rename the lookup misses on the very first keystroke and stays missed.

**Changed.** `src/components/NyxmapCardEditor.ts:120-165` — `_entitiesChanged` now picks between
two matching strategies instead of always using the id map:

- Same list length **and** the same multiset of entity ids ⇒ a reorder (the list editor's ↑/↓
  buttons permute ids without changing the set) ⇒ match **by id**, as before.
- Same list length **and** a changed multiset ⇒ an in-place edit that touched an entity id ⇒ match
  **by position**, which is exactly right because nothing moved.
- Different length ⇒ an add or a remove ⇒ positional matching is ruled out (indices past the edit
  point have shifted) and id matching is used, which is correct there since add/remove never
  rename.

This is the audit's suggested "fall back to positional matching when the id lookup misses and the
list length is unchanged", tightened: deciding on the id multiset rather than a per-row lookup miss
also handles the case where a row is renamed to an id that another row already holds, where a
per-row fallback would still copy the *other* entity's keys.

**Tests** (`src/components/NyxmapCardEditor.test.ts`, 4 new cases): keeps `circle`/`geojson`
through an in-place rename; does not resurrect a removed entity's keys onto the rows that shift up;
gives a newly added blank row no inherited keys; keeps YAML-only keys through a rename typed one
character at a time (three successive `items-changed` events, each landing on the config the
previous one produced — the real editing sequence). The two existing tests that pin the
edit-another-row and reorder behaviours still pass unchanged, which is the regression guard for the
strategy switch.

---

## CR §15 — card-level fields can't be cleared through the visual editor

**Verified first.** `formDataToCardConfig` (`CardFormSchema.ts:96-107` at `34b7695`) opened each
iteration with `if (!(key in data)) continue;` over a `next` seeded from `{ ...previous }`, so a
key absent from `ev.detail.value` kept its old value. A key present as `""` was worse than the
audit describes: it was written through as an empty string, so `title: ""` was emitted into the
saved YAML rather than removed. Only `height` cleared properly, via `parseHeight("") → undefined` —
and even that left `height: undefined` on the object rather than deleting the key.

**Changed.** `src/editor/CardFormSchema.ts:96-123` — the loop now resolves each schema key's value
once (via `parseHeight` for `height`) and **deletes** the key from `next` when that value is
`undefined`, `null`, or `""`, otherwise assigns it. `false` and `0` are values, not clears, and
survive. Out-of-scope keys are untouched, since the loop only ever visits `CARD_SCHEMA_KEYS`.

**Why treating "absent" as a clear is safe:** the form data handed to `ha-form` is
`cardConfigToFormData(this._config)`, which emits every schema key the config actually has. So a
key absent from what comes back is either never-set (deleting is a no-op) or just-cleared
(deleting is the fix). That reasoning is written into the function's doc comment, because it is the
thing that makes the branch non-obvious.

**Residual uncertainty (the audit's "Plausible").** Which of the three shapes — `undefined`, `""`,
or an omitted key — a given `ha-form` selector emits on clear was **not** verified against a live
Home Assistant frontend; `ha-form` is provided by the surrounding frontend and only duck-typed here
(`src/types/ha-form.d.ts`). The fix sidesteps the question by handling all three identically, which
is why it does not depend on the answer. `null` is handled too, for the same reason.

**Tests** (`src/editor/CardFormSchema.test.ts`, new `describe("clearing a field")`, 5 cases): a text
field cleared to `""`; a field reported as `undefined`; a field omitted from the emitted value
entirely; clearing a schema key while `entities`/`geojson` survive; `false`/`0` treated as values.
The pre-existing "clears height back to the default when the field is emptied" test still passes
(`toBeUndefined()` holds for a deleted key).

---

## Documentation follow-ups

### `CLAUDE.md` — "a throwing plugin can't take the card down", restated

`CLAUDE.md:200-236` (the JS-plugin-hook section) previously carried one sentence: *"Each
`setup(ctx)` runs in try/catch so a throwing plugin can't take the card down."* That understated
what wave 1 landed and omitted a constraint plugin authors are now bound by. It is replaced with a
`#### Fault isolation` subsection naming all four guards, plus an expanded `registerOverlay`
bullet. Every claim was read out of the current source, not the audit:

| Claim written | Verified against |
|---|---|
| `window.nyxmapPlugins` entries each run in their own try/catch, `console.error`, next plugin continues | `PluginHost.ts:65-72` |
| The `nyxmap-map-ready` path is not wrapped by us | `PluginHost.ts:74-83` — bare `dispatchEvent`, with the same rationale in its comment |
| `registerControl` wraps `map.addControl` because it synchronously calls third-party `onAdd()` | `PluginHost.ts:100-113` |
| `replayAll` isolates each factory and snapshots the registry first | `StyleReattach.ts:46-54` (`for (const [id, factory] of [...this.factories])` + try/catch) |
| A throwing factory stays registered | `StyleReattach.ts:46-54` — nothing removes it; matches Track B's stated rationale |
| Why isolation matters *past the first style load* | `NyxmapCard.ts:602-607` — `replayAll` runs first in the `"style.load"` handler, `_pluginHost?.activate()` immediately after, and tile layers/entities/geojson/history/initial view after that |
| Overlay ids are rejected, all-or-nothing, with a `console.warn` suggesting `plugin:<id>` | `PluginHost.ts:156-169` |
| Reserved prefixes are `history-`, `circle-`, `geojson-`, `tile-layer-`, `wms-layer-` | `PluginHost.ts:19` (`RESERVED_OVERLAY_ID_PREFIXES`), cross-checked against the real id builders: `HistoryRenderService.ts:16`, `CircleRenderService.ts:12`, `GeoJsonRenderService.ts:23`, `TileLayersRenderService.ts:75-76`, and the plugin-facing contract in `src/types/nyxmap-plugin.d.ts:65-66` |
| The static prefix list is not redundant with the dynamic `reattach.has()` check | `PluginHost.ts:9-19` comment + the ordering above: `activate()` precedes the render services' first `update()` |
| `PluginHost` is built in `_buildMap()` and gated by the `plugins` config | `NyxmapCard.ts:561`; `MapConfig.plugins` defaults `true` |

The pre-existing sentences the section already had (setup runs once, the two registration paths,
`registerOverlay`'s three-registration trio, `injectStyle`'s shadow-root rationale, protocols not
being first-class) were re-read and left as they were — still accurate.

README's plugin note (`README.md:300-307`) carried the softer *"Give overlay ids a prefix … so they
don't collide"*, which is now a hard rule rather than advice; it says outright that a colliding id
is rejected and lists the reserved prefixes. The compass example and the commented-out control line
in the quakes example were switched from `ctx.map.addControl(...)` to `ctx.registerControl(...)`,
since the README table documents `registerControl` as the supported path and only that path gets
the `onAdd` isolation the same page now advertises.

### `README.md` — `focus_follow` re-checked against wave 1's camera change

The row was wrong in two ways, one pre-existing and one introduced by wave 1. Read
`InitialViewRenderService.ts:81-125` and its two call sites (`NyxmapCard.ts:266-272` and
`:738-743`):

- *"`refocus` re-centers on every update"* — no longer true. `updateFit` returns early when
  `_lastFitted` equals the freshly computed bounds (`:104`), so it re-fits only when the tracked
  entities' bounding box actually changed.
- *"`contains` only re-fits when `focus_entity` leaves the current view"* — was never true.
  `_boundsOf` (`:127-133`) collects **every** entity with `focusOnFit`, not `focus_entity`; the
  guard is `boundsContains(map.getBounds(), padded)` (`:96`) over that combined box. `focus_entity`
  only participates in the *initial* center (`getInitialCenter`, `:54-65`).
- Added: a fit that resolves to a single point centers at `zoom` rather than fitting a zero-area
  box (`:110-123`), and both call sites pass `this._config.zoom` as `pointZoom`, so the documented
  value is the `zoom` option and not the `DEFAULT_POINT_ZOOM = 12` fallback.

The `zoom`, `x`/`y` and `focus_entity` rows were re-read and are still accurate; the
`#entity-options` anchor used by the new text exists (`focus_on_fit` is documented there).

### `CHANGELOG.md` — `[Unreleased]` entry

Checked the convention first, as instructed: the file states it *"loosely follows Keep a
Changelog"*, already carried an empty `## [Unreleased]` heading directly under the preamble, and
released sections use `### Added` / `### Changed` / `### Fixed` with prose bullets. The new entry
matches that exactly — `### Fixed` then `### Changed`, prose bullets, user-visible framing rather
than file/function names. **No released section was touched.**

It covers wave 1 (tracks A, B, C) plus this track: teardown/re-parent, the `_ready`-during-swap
throw, `focus_follow: refocus` fighting the user, the single-entity max-zoom slam, the
style-unchanged config refresh, the three editor fixes here, plugin fault isolation + reserved
overlay ids, and the documentation pass. Wave 1's items were written from the tracks' own write-ups
**cross-checked against the source** (`NyxmapCard.ts` `connectedCallback`/`_teardown`/`_applyStyle`/
`_refreshOverlays`, `InitialViewRenderService._fit`/`_lastFitted`, `StyleReattach.replayAll`,
`PluginHost._registerOverlay`), not copied from them.

---

## Deliberately not done

- **No guard added inside `_onSelectBaseStyle`/`_resolveActiveStyleUrl`** (the second half of §13's
  suggested fix). `src/components/NyxmapCard.ts` belongs to the sibling this pass. It is
  defence-in-depth rather than a second defect: after `parseMapStyles`, `config.mapStyles` cannot
  contain a falsy `styleLight`, so no registry entry built from it can. Worth adding whenever
  `NyxmapCard.ts` is next open.
- **`src/editor/MapStyleFormSchema.ts` unchanged.** Checked: `name` and `map_style` already carry
  `required: true` (`:8-9`), so the form-level half of §13 is in place; the defect was purely the
  absent runtime validation.
- **`src/components/NyxmapFormListEditor.ts` unchanged.** Its emit-on-add behaviour (`:104-108`) is
  what makes §13 trivially reachable, but suppressing the event until a row is valid would break
  the generic contract it also serves for entities (where a blank `{ entity: "" }` row is a
  legitimate intermediate state, and where the row must be added to the parent's config for the
  form to render at all). Validating at the parse boundary handles it without touching the shared
  component.
- **The 13 source-comment cross-references** in `track-c-docs.md` §3 — explicitly out of scope for
  this track; they span files the sibling owns.
- **`display: "state"` (§8) and `z_index_offset`** — left entirely alone in `EntityFormSchema.ts`
  and its labels, per the brief; the sibling owns both.
- **No commit.**

---

## Known interaction with the concurrent sibling track

The sibling is mid-flight on CR §16 (tile-layer state keyed by list index). Their in-progress
`TileLayersRenderService.ts` replaces `${kind}-layer-${index}` with `${kind}-layer-${token}` and
their comment states the `tile-layer-`/`wms-layer-` prefixes are kept verbatim *because* they are
part of the reserved-id namespace — so the prefix list this track documents in CLAUDE.md and README
stays correct under their change. Worth a re-read if that decision changes before merge.

Their work was also the sole cause of the only red runs seen during this track: mid-flight,
`src/services/render/TileLayersRenderService.test.ts` (9 failures) and one `NyxmapCard.test.ts`
case still asserted the old index-based ids against their new implementation, and
`src/components/NyxmapCard.ts` briefly carried an unused-variable lint warning
(`HISTORY_REFRESH_MS`, their §12 work). Both had cleared by the final gate below, which is fully
green. Confirmed at the time that none of it touched anything this track changed: the same run with
`--exclude src/services/render/TileLayersRenderService.test.ts --exclude src/components/NyxmapCard.test.ts`
was 31 files / 293 tests passing.

---

## Gate output (verbatim tails)

Run against the settled working tree at the end of this track. `npm run test:coverage` was not run,
per the brief.

### `npm run typecheck`

```
> ha-nyxmap-card@0.9.1 typecheck
> tsc --noEmit

```

Clean — no output, exit 0.

### `npm run lint`

```
> ha-nyxmap-card@0.9.1 lint
> eslint src

```

Clean — no output, exit 0. (An earlier run mid-track reported one warning,
`'HISTORY_REFRESH_MS' is assigned a value but never used` in `src/components/NyxmapCard.ts`; that
is the sibling's in-flight §12 work and it had cleared by the final run.)

### `npm test`

```
 ✓ src/maplibre/IconButtonControl.test.ts (4 tests) 42ms
 ✓ src/maplibre/MarkerAnimator.test.ts (6 tests) 35ms
 ✓ src/components/NyxmapFormListEditor.test.ts (6 tests) 148ms
 ✓ src/models/Circle.test.ts (8 tests) 8ms
 ✓ src/configs/EntityConfig.test.ts (8 tests) 11ms
 ✓ src/services/HaUrlResolveService.test.ts (5 tests) 11ms
 ✓ src/configs/LayerConfig.test.ts (7 tests) 16ms
 ✓ src/util/geo.test.ts (8 tests) 12ms
 ✓ src/services/render/LayerRegistry.test.ts (4 tests) 10ms
 ✓ src/configs/CircleConfig.test.ts (6 tests) 10ms
 ✓ src/configs/GeoJsonConfig.test.ts (4 tests) 8ms
 ✓ src/models/GeoJson.test.ts (6 tests) 10ms
 ✓ src/editor/MapStyleFormSchema.test.ts (2 tests) 11ms
 ✓ src/models/EntityHistory.test.ts (2 tests) 3ms

 Test Files  33 passed (33)
      Tests  358 passed (358)
   Start at  13:14:59
   Duration  8.41s (transform 2.03s, setup 363ms, collect 4.50s, tests 2.19s, environment 24.63s, prepare 9.35s)
```

Up from the 332 at the `34b7695` baseline; **16** of the 26 new tests are this track's
(7 `MapConfig` + 5 `CardFormSchema` + 4 `NyxmapCardEditor`), the rest the sibling's.
