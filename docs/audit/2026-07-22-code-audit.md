# Professional code audit — ha-nyxmap-card

**Date:** 2026-07-22 · **Version:** v0.10.2 · **Branch:** `claude/code-audit-orchestrator-6ojvz7`

This audit was run as an **orchestrated, multi-lens review**: one orchestrator
partitioned the work across three specialist auditors — **correctness**,
**architecture / maintainability**, and **security** — each sweeping the whole
`src/` tree through its own lens. Every finding below was then **independently
re-verified by the orchestrator against the actual source** (file:line read and
confirmed) before being recorded; claims that could not be reproduced were
dropped. Verification status is stated per finding.

Nothing in the shipped code was modified *during the audit pass* — it was
read-only. The findings were **remediated in a follow-up pass on the same
branch** (see below).

## Remediation status (follow-up pass)

Every finding below was fixed on this branch, each with regression tests; the
full gate is green afterward (typecheck, lint `--max-warnings 0`, **479 tests**
— up from 462, +17 new — and a clean build).

| # | Finding | Fix |
|---|---|---|
| A1/A2 | `entity-clusters` outside the reserved-id guard; duplicated literal | Added `CLUSTER_OVERLAY_ID` + `RESERVED_OVERLAY_IDS` to `OverlayIds.ts`; `PluginHost` now rejects the exact id; `ClusterRenderService`/`NyxmapCard` import the constant. Parameterized rejection test extended with `entity-clusters`. |
| C1 | Raster/WMS `setTiles` on every `hass` tick | Added an opt-in `dataKey` guard to `OverlaySource` (skips the data push when unchanged); `TileLayersRenderService` keys it on the resolved URL. Tests: skip-on-unchanged, push-on-change. |
| A3 | `PluginHost` hand-rolled the overlay protocol | Extracted `registerOverlayLifecycle`; both `OverlaySource.upsert` and `PluginHost` funnel through it. Existing 20 PluginHost tests still green. |
| A4 | Style/theme resolution trapped in the element | Extracted pure `BaseStyleResolution.ts` (`effectiveThemeMode`, `resolveActiveStyleUrl`, `defaultBaseStyleId`, `baseStyleZoomRange`, `initialManualStyleId`) with 11 `node` tests; element delegates. |
| C3 | Dangling `_manualStyleId` after a selected style is removed | `_syncBaseStyles` re-derives the selection via `initialManualStyleId(config)`, matching fresh-load state. Element regression test added. |
| S1 | Un-encoded entity state in tile/WMS URLs | `encodeURIComponent` on the substituted state; templating test updated + new case. |
| C2 | `reconcileEntityList` cross-wires duplicate ids | Per-id buckets consumed once (`shift`) instead of last-wins; duplicate-id test added. |
| A5/A6 | Doc drift (`MapSeamConformance` omitted; migration overstated) | `CLAUDE.md` updated: documents `MapSeamConformance`, `registerOverlayLifecycle`, `RESERVED_OVERLAY_IDS`, and `dataKey`. |
| — | Lockfile version drift | Reconciled to `0.10.2` (hygiene — see the corrected Gate note below; it did **not** break `npm ci`). |

---

## Gate baseline (verified this session, deps freshly installed)

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **PASS** — 0 errors |
| `npm run lint` (`eslint . --max-warnings 0`, type-aware over `src/**`) | **PASS** |
| `npm test` (`vitest run`) | **PASS** — 36 files, 462 tests |
| `npm run build` | **PASS** — `dist/nyxmap-card.js` ≈ 1,715 kB / 373 kB gzip |
| Coverage (informational) | ~98.97% stmts / ~91.61% branch / ~97.39% funcs |

**Two environment notes surfaced while running the gate (not shipped-code defects):**

- **Lockfile version drift (hygiene, not a CI-blocker).** `package-lock.json`
  recorded version `0.10.1` while `package.json` is `0.10.2`. *Correction to an
  earlier draft of this audit:* this does **not** break `npm ci` — verified with
  `npm ci --dry-run`, which passes with the drift present (modern npm enforces
  lockfile agreement on **dependency** entries, not the root project `version`
  field). The `npm ci` failure seen at audit time was a concurrent-install
  `ENOTEMPTY` race in the shared workspace, unrelated to the version. Reconciled
  the lockfile to `0.10.2` anyway as tidiness.
- **`npm audit`: 6 advisories (2 critical / 1 high / 3 moderate) — all in the
  dev toolchain** (`vitest`/`vite`/`esbuild`/`@vitest/*`). **None reach the
  shipped runtime bundle** (`maplibre-gl`, `lit`, `@turf/circle`). Informational;
  bump the dev chain at leisure.

---

## Findings summary

| # | Lens | Severity | Status | Finding |
|---|---|---|---|---|
| A1 | Architecture | **Medium** | Confirmed | `entity-clusters` overlay id sits outside the reserved-prefix guard — a plugin can silently corrupt the built-in cluster overlay |
| C1 | Correctness | **Medium** | Confirmed (mechanism) | Raster/WMS overlays call `setTiles()` on **every** `hass` update with no data-identity guard → needless source reloads / WMS re-requests |
| A3 | Architecture | **Medium** | Confirmed | `PluginHost` still hand-rolls the overlay-registration protocol `OverlaySource` was built to centralize (the un-migrated "5th copy") |
| A4 | Architecture | Medium | Opinion | Style/theme/zoom resolution logic trapped in the 944-line `NyxmapCard` element; only reachable through jsdom |
| A2 | Architecture | Low-Med | Confirmed | `entity-clusters` is a magic string duplicated across two modules |
| A5 | Docs | Low-Med | Confirmed | `CLAUDE.md` omits `src/maplibre/MapSeamConformance.ts` (an invisible-value safety net, easy to delete as "dead code") |
| A6 | Docs | Low | Confirmed | `CLAUDE.md` implies the `OverlaySource` migration is complete; `PluginHost` contradicts it (ties to A3) |
| S1 | Security | Low | Plausible | Entity state interpolated **un-encoded** into tile/WMS request URLs — request manipulation, **not** XSS |
| C2 | Correctness | Low | Plausible | `reconcileEntityList` cross-wires YAML-only keys when two rows share an `entity` id |
| C3 | Correctness | Low | Plausible | Stale `_manualStyleId` after a selected `map_styles` entry is removed — switcher shows no selection |
| S6 | Security | Info | — | Default map styles are third-party public endpoints (privacy/availability) |

---

## Correctness

### C1 — Raster/WMS overlays reload on every `hass` update (Medium, confirmed mechanism)

`OverlaySource.upsert()` (`src/services/render/OverlaySource.ts:130-146`) gates
*source rebuilds* behind `sourceKey` and *paint* behind `paintKey`, but the
**data push has no equivalent key** — when a source already exists and isn't
stale it calls `updateSourceData()` unconditionally. For raster,
`TileLayersRenderService.updateSourceData` (`:160-162`) calls
`source.setTiles(tiles)`, and MapLibre's `setTiles` → `setSourceProperty`
aborts the in-flight tileJSON request and reloads the source even when the
tiles array is byte-identical (confirmed in the bundled `maplibre-gl`).

Home Assistant replaces the whole `hass` object on every state change anywhere
in the instance (the codebase relies on this elsewhere). Each churn runs
`NyxmapCard.updated()`'s hass branch → `_refreshOverlays()` (`:790`) →
`_tileLayers.update()` → `upsert()` → `setTiles([sameUrl])` for **every**
raster/WMS layer — many times per second, with zero config change. WMS is the
sharp edge: repeated GetMap re-requests to a third-party server and visible
overlay flicker. (Plain raster likely hits the browser HTTP cache, so its
visible impact is more modest — appropriately hedged.)

*Verified:* read `OverlaySource.upsert` (no data guard), `updateSourceData` →
`setTiles`, `_refreshOverlays` unconditional call on `changed.has("hass")`, and
`setSourceProperty`'s reload in bundled MapLibre. The existing test
`TileLayersRenderService.test.ts:146` asserts `setTiles` fires on an unchanged
update — i.e. current behavior is codified.

*Suggested fix:* add a per-id `dataKey` to `OverlaySource` (mirroring
`paintKey`/`sourceKey`) and skip `updateSourceData` when unchanged; for raster
the key is just the resolved tiles URL.

### C2 — `reconcileEntityList` cross-wires keys on duplicate entity ids (Low, plausible)

`src/editor/EntityListReconcile.ts:46-64`. `previousByEntityId` is a `Map`
keyed by entity id built in a loop, so duplicate ids collapse to the last
occurrence. In the `sameIds` (match-by-id) branch, every row with that id
resolves its "previous" raw to that same last entry.

*Scenario:* two entries for `device_tracker.x` — row 0 has a `geojson:` block,
row 1 doesn't. Editing row 1's `label` in the visual editor makes both rows
resolve to row 1's raw, dropping row 0's `geojson:`. Low because duplicate
entity ids on one map is an uncommon config.

*Suggested fix:* fall back to positional (or first-unconsumed-by-id) matching
when the previous list contains duplicate ids.

### C3 — Stale `_manualStyleId` after a selected base style is removed (Low, plausible)

`src/components/NyxmapCard.ts` — `_syncBaseStyles` unregisters a removed
`map_styles` entry but never resets `_manualStyleId` if it pointed at that
entry. `_resolveActiveStyleUrl` (`:414`) then falls back to the card-level style
(reasonable), but `_baseStyleItems` computes an `activeId` matching no remaining
entry, so the switcher shows **no** radio highlighted until the user clicks one.
UI-only; no crash or data loss.

*Suggested fix:* clear `_manualStyleId` in `_syncBaseStyles` when its target
leaves the registry, letting it fall back to `_defaultBaseStyleId`.

### Correctness — checked and found sound (no defect)

The history refresh chain (`HistoryRefreshController`: generation guard,
in-flight coalescing, catch-up latch, `stop()` invalidation during deferred
teardown), the style-swap re-attach invariant (every source/layer producer
registers a `StyleReattach` factory; HTML markers correctly do not),
lifecycle/cleanup (`ResizeObserver`, `matchMedia`, outside-pointerdown listener,
deferred-teardown timer, `map.remove()`, `MarkerAnimator` WeakMap timers), and
`OverlaySource` teardown symmetry / stale-`sourceKey` rebuild were all traced
and are correct.

---

## Architecture & maintainability

### A1 — `entity-clusters` sits outside the reserved-id guard (Medium, confirmed)

This is precisely the failure mode `RESERVED_OVERLAY_ID_PREFIXES` exists to
prevent — and clustering is the one built-in overlay it doesn't cover.

`entity-clusters` is a real overlay id registered into `LayerRegistry`
(`ClusterRenderService.ts:10,152`), but it is neither in `OVERLAY_ID_PREFIXES`
nor reachable via any reserved prefix (`OverlayIds.ts:20-32` lists only
`history-/circle-/geojson-/tile-layer-/wms-layer-`). The `style.load` handler
ordering is **`replayAll` → `pluginHost.activate()` → `_refreshOverlays()`**
(`NyxmapCard.ts:761,766,768`), and the cluster service only registers inside
`_refreshOverlays()`. So a plugin calling `registerOverlay("entity-clusters", …)`
at `activate()` time passes **both** guards in `PluginHost._registerOverlay`
(`:177-190`): the static prefix check (not a reserved prefix) **and** the
dynamic `reattach.has` / `layerRegistry` check (cluster hasn't registered yet).
Moments later `ClusterRenderService.update()` overwrites the `LayerRegistry`
entry via `Map.set` — the exact "split state" `PluginHost` documents as
unrecoverable, for the one id the reserved list forgot.

*Verified:* read all three sites — the id's absence from `OverlayIds`, the
guard body, and the `761→766→768` ordering that makes the dynamic check pass.
Note the trust framing: plugins are already inside the trust boundary (S3), so
this is a robustness / invariant-integrity gap, not a privilege escalation — but
it directly falsifies the documented "single source of truth" guarantee.

*Suggested fix:* export a `RESERVED_OVERLAY_IDS` set from `OverlayIds.ts`
containing `entity-clusters`, check it in `PluginHost._registerOverlay`, and
have `ClusterRenderService` import the constant instead of its own literal —
closing A2 in the same move.

### A2 — `entity-clusters` magic string duplicated across modules (Low-Med, confirmed)

`ClusterRenderService.ts:10` (`OVERLAY_ID`) and `NyxmapCard.ts:843-844` (two
bare `"entity-clusters"` literals driving the Toggle-grouping button and the
switcher checkbox) are coupled only by a repeated string and a "must not change"
comment. Renaming in one place silently drives a dead id. Folds into the
`OverlayIds.ts` export from A1.

### A3 — `PluginHost` hand-rolls the protocol `OverlaySource` centralizes (Medium, confirmed)

`CLAUDE.md`'s "Adding an overlay type" states the protocol "used to be
hand-rolled five times (the four services plus PluginHost)" and says "Extend
`OverlaySource` — do not hand-roll." The four services were migrated;
**`PluginHost` was not.** `PluginHost._registerOverlay` / `_addOverlay`
(`:176-222`) re-implement the same trio the base owns — `getSource`-guarded add
+ `reattach.register` factory + `layerRegistry.registerOverlay` with a per-layer
`setVisible` — plus a parallel `_overlayVisible` map mirroring
`OverlaySource.visibility`. Any fix to reattach/visibility semantics (the base's
whole reason for existing — the wave-2 paint fix that "missed a branch" is cited
as why) must still be applied in two places, and the second is the seam most
exposed to third parties.

*Nuance:* the plugin path can't cleanly subclass `OverlaySource<TKey,TItem>` (it
takes a pre-built external spec, not a keyed item) — but the
*register+reattach+visibility* half is identical and extractable into a shared
helper both `OverlaySource.upsert` and `PluginHost` funnel through.

### A4 — Decision logic trapped in the `NyxmapCard` element (Medium, opinion)

`NyxmapCard.ts` is 944 lines and holds the largest remaining pockets of
pure-ish logic only reachable through jsdom: theme/style resolution
(`_effectiveThemeMode`, `_resolveActiveStyleUrl`, `_defaultBaseStyleId`, the
zoom-range pick), and the overlay-visibility desired-vs-applied diff
(`_syncOverlayVisibility`). These mirror the repo's own established extraction
precedent (`LayerSwitcherLayout`, `EntityListReconcile`, `src/editor/*`) and are
the reason `NyxmapCard`'s branch coverage (~85%) is the second-lowest in the
tree — they're exercised only via the 1,400-line jsdom test file.

*Suggested fix:* extract a `StyleResolution` module of pure functions of
`(config, _manualStyleId, _manualThemeMode, prefersDark, registry)` and
unit-test under `node`; leave only the `entry.setVisible(map,…)` try/catch in
the element.

### A5 — `CLAUDE.md` omits `MapSeamConformance.ts` (Low-Med, confirmed)

The `src/maplibre/` inventory in `CLAUDE.md` lists six files but not
`src/maplibre/MapSeamConformance.ts` — the compile-time guard that keeps every
`*Like` map seam honest against the real `maplibregl.Map` (it exists because
`focus_follow: "contains"` shipped broken through an `as unknown as` cast). Being
type-only and unimported, it's easy to delete as "dead code" precisely because
its value is invisible. Worth a one-line mention.

### A6 — `CLAUDE.md` overstates the `OverlaySource` migration (Low, confirmed)

The "used to be hand-rolled five times" framing reads as fully solved, but
`PluginHost` still carries a hand-rolled copy (A3). Either migrate it or add one
sentence noting `PluginHost` deliberately keeps a parallel implementation
because plugin specs aren't keyed items.

### Architecture — claims actively falsified and found accurate

Coverage numbers, per-file 70% floors, `tsconfig` strictness, `hacs.json`
`filename`, CHANGELOG = package.json version, `docs/audit/` "Superseded"
banners, `dist/` gitignored + untracked, no `loadMapLibreFromCdn`/CDN escape
hatch remaining, type-aware lint scoped to `src/**`, and the porting backlog
(`history_date_selection`, WMS `TIME`, entity-valued `history_start`) genuinely
absent from `src/` — all hold. The docs are unusually honest; the items above
are the exceptions.

---

## Security

**Overall: no injectable HTML/JS sink found.** The DOM is built with
`textContent` / `createElement` / CSSOM setters, and all Lit templates use
auto-escaping `${…}` interpolation. Findings are Low/informational — mostly
confirmed-safe negatives worth recording.

### S1 — Un-encoded entity state in tile/WMS request URLs (Low, plausible)

`HaUrlResolveService.resolveUrl` (`:18`) replaces `{{ states('x') }}` with the
raw entity state via `String.replace` — **not** URL-encoded — then feeds it to a
MapLibre raster `tiles` URL (`TileLayersRenderService.ts:183,192`). A
compromised/spoofed entity can inject path/query fragments into the request.
**Impact is bounded and this is not XSS:** the sink is an `<img>`-style tile GET,
so `javascript:`/`data:` schemes don't execute; the templating engine supports
only `states()` via a fixed regex (no eval/Function). Realistic worst case is
request manipulation / minor exfil only when an author templated a secret into
the same URL where attacker-controlled state also lands. Note: base
`map_style`/`map_styles` URLs fed to `map.setStyle()` are **not** run through
the resolver, so entity state cannot influence the style-JSON URL.

*Suggested hardening (defense-in-depth):* `encodeURIComponent` the substituted
value.

### S2-S5 — Confirmed-safe negatives (verified)

- **Marker DOM is not an XSS sink** (`MarkerFactory.ts`). Despite building from
  attacker-controllable `entity_picture`/`icon`/`friendly_name`/state: text uses
  `el.textContent`; `entity_picture` goes through the `el.style.backgroundImage`
  CSSOM setter (binds to one property — a stray `;`/extra declaration is dropped,
  no CSS-property injection, `javascript:` URLs don't execute); `ha-icon`'s
  `icon` attribute is a name, not markup. `CSS.escape` would be belt-and-braces
  only.
- **GeoJSON & config merging** (`GeoJson.ts:14`) — `JSON.parse` in try/catch,
  no eval/template; `JSON.parse` and object-spread config merges cannot pollute
  `Object.prototype` (no `__proto__`/`prototype[...]` assignment anywhere in
  `src/`).
- **No ReDoS / no dynamic code** — regexes in `HaMapUtilities.ts` /
  `HaUrlResolveService.ts` are linear (no nested/ambiguous quantifiers); grep
  confirms no `eval`, `new Function`, `innerHTML`/`insertAdjacentHTML`/
  `unsafeHTML`, `document.write`, or `window.open` in shipped code.
- **Plugin hook is inside the trust boundary** (`PluginHost.ts`) — a registered
  plugin is arbitrary JS already in the page; `injectStyle`/`registerControl`
  grant nothing new. The try/catch guards and `replayAll` isolation are about
  **crash containment, not a sandbox** — don't mistake them for a privilege
  boundary. The overlay-id collision defense is sound for everything in the
  reserved set (A1 is the one id outside it).

### S6 — Default third-party style endpoints (informational)

`MapConfig.ts:12-14` defaults to `tiles.openfreemap.org` and
`basemaps.cartocdn.com`. Not a code bug (already flagged in `CLAUDE.md`), but
every pan/zoom leaks approximate location + timing to these third parties by
default, with no SLA. Worth documenting for privacy-sensitive / air-gapped
deployments; overridable via `map_style`/`map_style_dark`.

---

## Cross-lens corroboration

The three lenses reinforced rather than merely listed. The security auditor
independently judged the plugin overlay-id collision defense "sound" for the
reserved set; the architecture auditor found the **single built-in id outside
that set** (`entity-clusters`, A1) — the exact seam the security analysis
assumed was covered. Both the correctness and security passes independently
re-confirmed the `StyleReattach` theme-swap invariant holds. That agreement is
why A1 is the top-ranked actionable item: it's the one place a documented safety
guarantee is genuinely false today.

## Recommended order of work

1. **A1 + A2** (small) — one `RESERVED_OVERLAY_IDS` export closes the guard hole
   *and* the magic-string duplication. Highest leverage per line; restores the
   "single source of truth" guarantee.
2. **C1** (small-medium) — add a `dataKey` guard to `OverlaySource`; stops
   per-`hass`-tick WMS re-requests / raster reloads.
3. **A3** (medium) — unify `PluginHost`'s registration path with `OverlaySource`
   so overlay fixes stop needing double application at the least-trusted seam.
4. **A4** (medium) — extract `NyxmapCard`'s style/theme resolution into pure,
   `node`-testable functions.
5. **A5 + A6, C2, C3, S1** (small) — doc fixes, the reconcile dup-id guard, the
   `_manualStyleId` reset, and the `encodeURIComponent` hardening.
6. **Housekeeping** — reconcile `package-lock.json` to 0.10.2 (restores
   `npm ci`); bump the dev toolchain to clear the `npm audit` advisories.
