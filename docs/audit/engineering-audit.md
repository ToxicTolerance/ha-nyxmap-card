# Engineering audit — `ha-nyxmap-card`

- **Date:** 2026-07-21
- **Commit audited:** `1b7bc2d` (`v0.9.1: control-layout polish + plugin docs`), branch `master`, working tree clean
- **Scope:** `src/`, `test/`, `dev/`, `.github/`, root config and docs
- **Method:** all four toolchain commands were actually run on this commit (results in §5); all cited files were read directly.

## Summary

The engineering substance of this repo is in good shape and better than its documentation suggests.
`npm run typecheck`, `npm run lint`, `npm test` (33 files / 310 tests) and `npm run build` all pass
clean on `1b7bc2d`, TypeScript is fully strict *plus* `noUncheckedIndexedAccess`, and line coverage
sits at **90.93%** with configs, editors, services and utils at or near 100%. The `src/editor/`
split — pure, DOM-free schema/mapping functions unit-tested under vitest's `node` environment — is
a genuinely good pattern, and CI runs the same four commands on every push and PR. The problems are
concentrated in three places. First, **documentation has decayed to the point of being actively
misleading**: `CLAUDE.md`'s "Project" and "Architecture" preamble is *byte-identical to the Phase 0
scaffold commit* (`5038f66`) and still claims there is "no build tooling, package manifest, or test
suite" and that the project is a single file `maplibre-map-card.js` — a file that has not existed
for six feature releases — while ten source files cross-reference CLAUDE.md sections ("§5",
"Phase 9", "the phase plan", "the MapLibre bundling decision") that no longer exist anywhere in it.
`README.md`, by contrast, is accurate and current, which means the two docs now contradict each
other on multiple points. Second, there is a **single, clearly-shaped duplication**: five
components (four render services plus `PluginHost`) each hand-roll the same ~60-line "keyed GeoJSON
overlay lifecycle" — upsert, StyleReattach registration, LayerRegistry registration, teardown — and
that repetition is exactly what makes the "new overlays must register for re-attach or they vanish
on theme swap" invariant easy to get wrong. Third, a handful of smaller structural issues: a raw
**NUL byte embedded in `ClusterRenderService.ts`** (git and ripgrep both treat the file as binary),
a fleet of eight hand-written `*Like` duck-type interfaces that force fourteen
`as unknown as` casts at the `NyxmapCard` boundary, dead code (`loadMapLibreFromCdn`), and dead
config surface (`z_index_offset`, editable in the visual editor, read by nothing).

---

## 1. Documentation accuracy

### 1.1 `CLAUDE.md`'s Project/Architecture preamble is the unmodified Phase 0 scaffold text

- **Location:** `CLAUDE.md` lines 5–44
- **Impact:** **High.** This is the file every future contributor (human or agent) is told to read
  first. It currently instructs the reader to *not* assume `npm run build`/`test` exist and to go
  look for a `package.json` — while a working `package.json`, Vite build, vitest suite, eslint
  config and CI pipeline all exist. An agent following it literally would decline to run the test
  suite and would go editing a file that isn't there.
- **Observation:** `git show 5038f66:CLAUDE.md | head -30` returns text identical to the current
  file's first 30 lines. Concretely wrong claims:
  - "There is currently no build tooling, package manifest, or test suite in this repo" — there is
    a full Vite 6 / vitest 2 / TypeScript 5.7 / eslint 9 setup.
  - "it is a single-file custom element (`maplibre-map-card.js`)" — `src/` holds ~40 modules;
    `grep -rn maplibre-map-card` over the whole repo hits **only CLAUDE.md** (3 times). The file
    does not exist and never appears in `git ls-files`.
  - "**Dev**: copy the file to `/config/www/maplibre-map-card.js`" — the real dev loop is
    `npm run dev` against `dev/harness.html` with a mocked hass, as `README.md` correctly documents.
  - "**Prod (planned)**: bundle MapLibre via its own Rollup config instead of pulling it from the
    `unpkg` CDN at runtime (see `loadMapLibre()`)" — MapLibre *is* bundled (`vite.config.ts` lib
    build, 1.69 MB output); there is no `loadMapLibre()`.
  - "The file is organized into banner-delimited sections that map 1:1 to where `ha-map-card`'s own
    modules would live" — those sections became real directories (`configs/`, `services/`,
    `services/render/`, `models/`, `util/`) some time ago. The stated *intent* (mirror upstream's
    module boundaries to stay diffable) is still honoured by the layout; only the "one file with
    banners" framing is stale.
  - The `### Not yet ported` backlog lists `tile_layers`/WMS and `geojson:` as unimplemented. Both
    are shipped (`src/services/render/TileLayersRenderService.ts`,
    `src/services/render/GeoJsonRenderService.ts`, both documented in README with config tables).
    Only `history_date_selection` genuinely remains — which is what README's Roadmap says.
  - It points the reader at "the bottom of `maplibre-map-card.js`" for the porting backlog.
- **Recommendation:** *(small)* Rewrite the Project section against reality: `src/` module tree,
  the four npm scripts, `dev/harness.html` as the dev loop, MapLibre bundled not CDN-loaded. Delete
  the `tile_layers`/`geojson` entries from the backlog, leaving only `history_date_selection`, and
  point at `README.md`'s Roadmap as the single source. The Architecture sub-sections written *after*
  Phase 0 (theme-swap invariant, visual editor, plugin hook, control layout) are accurate and should
  be kept as-is.

### 1.2 Ten source files cross-reference CLAUDE.md sections that no longer exist

- **Location:** `src/configs/MapConfig.ts:11,115,122`, `src/configs/EntityConfig.ts:27`,
  `src/configs/LayerConfig.ts:14`, `src/util/HaMapUtilities.ts:66`,
  `src/maplibre/MapLibreLoader.ts:13`, `src/maplibre/StyleReattach.ts:7`,
  `src/services/render/TileLayersRenderService.ts:28`, `src/components/NyxmapCardEditor.ts:63`
- **Impact:** **Medium.** Each is a comment promising the rationale lives elsewhere; following any
  of them is a dead end, which erodes trust in *every* "see CLAUDE.md" pointer including the ones
  that do resolve.
- **Observation:** Live references include "see CLAUDE.md §5 for keys that don't carry over 1:1",
  "see CLAUDE.md §5 'Open risk to flag'", "see CLAUDE.md §5 'Layer switcher'", "per CLAUDE.md's
  globe decision", "see CLAUDE.md's 'MapLibre bundling' decision", "see CLAUDE.md / the phase plan",
  "see CLAUDE.md Phase 9". Current CLAUDE.md has no numbered sections, no phase plan, no "Open risk
  to flag", and no "MapLibre bundling" heading. `README.md`'s closing line — "See `CLAUDE.md` for
  the full architecture notes and **phased plan**" — is the same dangling promise from the README
  side.
- **Recommendation:** *(small)* Two options, both cheap: either inline the one-line rationale at
  each call site and drop the pointer, or reintroduce stable named anchors in CLAUDE.md and update
  the ten comments to match. Prefer inlining for the short ones (globe default, bundling decision)
  and anchors for the ones that genuinely need prose (the theme-swap invariant, already anchored).

### 1.3 README and CLAUDE.md contradict each other on map-control placement

- **Location:** `README.md` (`cluster_markers` row), `CLAUDE.md` "Map control layout",
  `src/components/NyxmapCard.ts:386`
- **Impact:** **Low**, but it is the kind of drift that turns into a "fix" of working code.
- **Observation:** v0.9.1 moved the layer-switcher toggle to the top-right column
  (CHANGELOG is explicit about this, `LayerSwitcherControl._measure()` implements it, CLAUDE.md
  describes it correctly). Two places didn't follow: `README.md`'s `cluster_markers` row still says
  the button adds a "bottom-left 'Toggle grouping' map button" (it is added `"top-right"` at
  `NyxmapCard.ts:568`), and the comment at `NyxmapCard.ts:386` still says "the layer switcher now
  lives bottom-left and attribution bottom-right".
- **Recommendation:** *(small)* Fix the README row and the stale in-code comment. Worth a quick
  sweep of the rest of README's control-position language at the same time.

---

## 2. Architecture and module boundaries

### 2.1 The overlay lifecycle is copy-pasted five times — and that is what makes the theme-swap invariant easy to break

- **Location:** `src/services/render/CircleRenderService.ts`,
  `src/services/render/HistoryRenderService.ts`, `src/services/render/GeoJsonRenderService.ts`,
  `src/services/render/TileLayersRenderService.ts`, `src/maplibre/PluginHost.ts`
- **Impact:** **High** — this is the highest-leverage structural finding. CLAUDE.md correctly
  identifies "any new overlay type must plug into the re-attach path or it silently vanishes on the
  next theme change" as *the* non-obvious invariant. But the only thing enforcing it today is
  remembering to copy the previous service's `_upsert`/`_remove` body correctly. The failure mode
  is silent, visual, and only reproduces after a theme swap — the worst possible combination.
- **Observation:** Each of the five carries the same private state (`active: Set<string>`,
  `visibility: Map<string, boolean>`) and the same four-step shape:
  1. `getSource(id)` → `setData()`/`setTiles()` if present, else `addSource` + N× `addLayer` +
     `active.add(id)`;
  2. `reattach.register(id, (map) => { if (m.getSource(id)) return; addSource; addLayers; })` — the
     `if (getSource) return` guard is duplicated verbatim in all five, complete with a near-identical
     comment ("Re-registering on every update keeps the replayed data current");
  3. `layerRegistry.registerOverlay(id, { label, group, setVisible })` where `setVisible` is always
     "write the local visibility map, then `setLayoutProperty(layerId, 'visibility', …)` over this
     overlay's layer ids";
  4. `_remove(id)` = `reattach.unregister` + `layerRegistry.unregister` + `visibility.delete` +
     `active.delete` + guarded `removeLayer`×N + `removeSource`.
  `PluginHost._registerOverlay`/`_addOverlay` even documents itself as "Same three registrations
  GeoJsonRenderService makes" — the duplication is known and accepted. The only real variation is
  the source update call (`setData` vs `setTiles`) and the layer-spec builder; `HistoryRenderService`
  adds genuine extra behaviour (reconciling a *varying* layer set as `history_show_lines`/`_dots`
  change), so it would be the one partial fit.
- **Recommendation:** *(medium)* Extract an `OverlaySource` / `OverlayController` collaborator (not
  a base class — these are composed services, and inheritance would drag in the config-specific
  `update()` signatures). Something like
  `new OverlaySource(map, reattach, layerRegistry, { id, label, group, buildSource, buildLayers, updateSource })`
  owning steps 1–4, with each render service reduced to config→geometry translation. That makes
  "register for re-attach" structurally impossible to forget rather than a documented convention,
  gives the invariant one place to be unit-tested, and shrinks four services plus `PluginHost`. Do
  this before adding a sixth overlay type. Guard the refactor with the existing per-service tests,
  which already assert the re-attach behaviour.

### 2.2 Eight hand-written `*Like` duck-types force fourteen `as unknown as` casts at the card boundary

- **Location:** `src/components/NyxmapCard.ts:421–450` (seven consecutive double casts),
  interfaces in `HistoryRenderService.ts:6` (`MapSourceLike`), `GeoJsonRenderService.ts:15`,
  `TileLayersRenderService.ts:11`, `EntitiesRenderService.ts:10,17,24`,
  `InitialViewRenderService.ts:10`, `ClusterRenderService.ts:~29`
- **Impact:** **Medium.** The duck-types are the right call for testability — they are what lets
  every render service be tested against `test/fakes/FakeMaplibreMap.ts` with no WebGL. The cost is
  paid at the one place it matters: `_buildMap()` passes the *real* `maplibregl.Map` through
  `as unknown as XLike` seven times in a row, and `as unknown as` disables structural checking
  entirely. If a `*Like` interface drifts from MapLibre's real signature (a rename, a changed
  return type across a maplibre-gl major), nothing in `typecheck` catches it — it surfaces at
  runtime in a browser.
- **Observation:** 14 non-test `as unknown as` occurrences in `src/`. `MapSourceLike`,
  `GeoJsonMapLike` and `TileLayersMapLike` differ only in `getSource`'s return type
  (`{setData}` vs `{setTiles}`) and one added `on/off` overload — `TileLayersMapLike`'s comment
  explicitly defends the split as "a distinct interface rather than a false-shared one", which is
  reasonable, but the three still restate `addSource`/`addLayer`/`removeLayer`/`removeSource`/
  `setLayoutProperty` identically.
- **Recommendation:** *(small)* Add one compile-time conformance assertion per interface — e.g.
  `const _conforms: MapSourceLike = null as unknown as maplibregl.Map;` in a type-only test file, or
  a `satisfies`-based check — so `tsc --noEmit` fails if the real `Map` stops satisfying a duck-type.
  That preserves the testability win and removes the silent-drift risk without touching the casts.
  Optionally, extract the common five methods into a `MapMutationLike` base the three extend.

### 2.3 `NyxmapCard` carries a lot of jobs, but the seams are mostly right

- **Location:** `src/components/NyxmapCard.ts` (659 lines, the largest module)
- **Impact:** **Low-Medium.** Not a size complaint — a card element legitimately owns lifecycle. The
  concern is that a few decisions with real logic in them are only reachable through the DOM class.
- **Observation:** Genuinely well-factored parts: every render concern is delegated to an injected
  service; base-style/overlay state is `@state` on the Lit layer with `LayerRegistry` deliberately
  non-reactive ("this class is just data" — a good, explicit boundary); the switcher component is
  documented as "dumb/presentational" and lives up to it. What remains card-private and
  DOM-coupled: `_syncBaseStyles()` (the "hide generic Light/Dark once `map_styles` exists" rule),
  `_resolveActiveStyleUrl()` (manual selection × theme mode × per-style pair resolution), and the
  `initialEntry` matching in `_buildMap()` (matching the configured style pair back to a named
  entry to pick up its zoom caps). All three are pure decisions over config; all three are currently
  testable only by driving the element under jsdom. `NyxmapCard.test.ts` does exactly that and
  reaches 97% line coverage, so this is not urgent — but that coverage costs a jsdom-environment
  pragma and a three-shim `test/setup.ts` (matchMedia, ResizeObserver, requestAnimationFrame).
- **Recommendation:** *(small)* Move those three into `src/editor/`-style pure helpers (e.g.
  `src/util/baseStyles.ts`: `resolveBaseStyleEntries(config)`, `resolveActiveStyle(config, manualId,
  manualTheme, prefersDark)`, `findInitialEntry(config)`), leaving `NyxmapCard` to call them. Mirrors
  the precedent CLAUDE.md already names as intended.

### 2.4 `ClusterRenderService` bundles four concerns in one 360-line file

- **Location:** `src/services/render/ClusterRenderService.ts`
- **Impact:** **Low.** It works, it is covered (98.67% lines), and the concerns are at least
  separated into distinct functions. Flagged as the thing most likely to become painful next.
- **Observation:** The file holds a `ClusterMapLike` duck-type, a `UnionFind` class, screen-space
  collision/grouping maths (`_computeGroups`, `_bestOverlap`, `pairKey`, hysteresis), *and* DOM
  bubble construction plus animation wiring (`_createBubble`, `_clearBubbles`, `MarkerAnimator` and
  `wrapAnimatedMarker` usage). Only the last group needs a DOM; the first three are pure. The test
  file must run under jsdom for all of it.
- **Recommendation:** *(small)* Lift `UnionFind` and the grouping maths into
  `src/util/clustering.ts` as pure functions over `{id, x, y, r}[]`. They then test in the `node`
  environment with no fake map at all, and the service shrinks to "project → group → render".

---

## 3. Extension points

### 3.1 `StyleReattach` and `LayerRegistry` are clean; the risk is entirely in *remembering to call them*

- **Location:** `src/maplibre/StyleReattach.ts` (33 lines),
  `src/services/render/LayerRegistry.ts` (50 lines)
- **Impact:** **Medium.** Both classes are about as simple and misuse-proof as they can be
  individually — `StyleReattach` is a keyed `Map<string, (map) => void>` with `replayAll`;
  `LayerRegistry` is two keyed maps with a documented "deliberately non-reactive" contract. Neither
  is the problem. The problem is that they are *three separate registrations* (`addSource/addLayer`,
  `reattach.register`, `layerRegistry.registerOverlay`) that every overlay author must perform by
  hand and keep in sync, plus a fourth (`unregister` from both) on teardown. See §2.1 — that is the
  same finding from the extension-point side.
- **Observation:** Two sharp edges worth naming. (a) `StyleReattach` keys are a flat global string
  namespace shared by internal overlays (`history-`, `circle-`, `geojson-`, `tile-layer-`,
  `wms-layer-`) and plugin overlays. `PluginHost._registerOverlay` warns on collision via
  `reattach.has(id)` — but *only warns*, then clobbers anyway; internal services do not check at
  all, so an entity id colliding across two services is silently last-write-wins. (b) `LayerRegistry`
  has a single `unregister(id)` that deletes from *both* the base-style and overlay maps, so an id
  colliding across the two categories would take out the wrong entry. Neither is likely today, but
  both are invisible when they happen.
- **Recommendation:** *(small)* Fold the three registrations into the §2.1 `OverlaySource`
  so an overlay is registered or not registered as a unit. Separately, split
  `LayerRegistry.unregister` into `unregisterBaseStyle`/`unregisterOverlay` (callers already know
  which they mean), and consider making `reattach.register` on an existing id throw in dev rather
  than warn.

### 3.2 `PluginHost` is a well-designed public surface, with one silently-lost failure path

- **Location:** `src/maplibre/PluginHost.ts`, `src/types/nyxmap-plugin.d.ts`
- **Impact:** **Low-Medium.** The design is good: dual registration (global array + composed event)
  mirroring HA conventions, `try/catch` per plugin so one bad plugin can't down the card,
  idempotent `activate()`, and `injectStyle` solving the genuinely non-obvious shadow-root problem.
  The contract is duck-typed in a `.d.ts` following the `home-assistant.d.ts` precedent, which is
  the right call for a plugin-author-facing surface.
- **Observation:** Three things a plugin author can get wrong with no useful signal. (1)
  `registerControl` is a bare `map.addControl` passthrough with no try/catch — unlike `setup()`
  itself — so a control that throws in `onAdd` escapes into MapLibre. (2) `_injectStyle`'s
  URL-vs-CSS heuristic (`/^https?:\/\//` or leading `/` or `.css`, and no `{`) will classify a raw
  CSS string containing no braces as a URL, and will classify a query-string-carrying CSS URL that
  happens to contain `{` as raw CSS — both fail silently as an unresolvable `<link>` or an
  ineffective `<style>`. (3) `ctx.reattach` is exposed to plugins as an "advanced escape hatch",
  which means the plugin surface inherits the flat-namespace collision issue from §3.1 with no
  guard rails at all. Coverage on this file is 92.22% with the uncovered lines being exactly the
  `injectStyle` no-shadow-root warning and the branch selection.
- **Recommendation:** *(small)* Wrap `registerControl` in the same try/catch+`console.error` as
  `setup`. Replace the heuristic with an explicit two-arg form (`injectStyle({url})` /
  `injectStyle({css})`) while keeping the current string form as a documented best-effort fallback,
  or at minimum log which branch it chose at debug level. Document the `plugin:`-prefix convention
  as a requirement in `nyxmap-plugin.d.ts`, not only in README prose.

---

## 4. Testability and coverage shape

### 4.1 Coverage is strong and — more importantly — the right *shape*

- **Location:** repo-wide
- **Impact:** informational (positive).
- **Observation:** 90.93% statements / 90.19% branches / 94.46% functions / 90.93% lines across 33
  files and 310 tests, in 18.4s. `src/configs` and `src/services` are at 100% across all four
  metrics; `src/editor` at 100%/98.52%; `src/util` at 100%. Tests co-locate with sources
  (`Foo.ts` + `Foo.test.ts`), the shared `test/fakes/FakeMaplibreMap.ts` is a deliberate hand-rolled
  double with a documented rationale (real MapLibre needs WebGL; no headless-gl), and jsdom is opted
  into per-file via `@vitest-environment` pragmas in exactly the 10 files that touch the DOM rather
  than being the global default. `test/setup.ts` explains each of its three shims. Test LOC
  (~4,311) is roughly at parity with source LOC (~4,719) — a healthy ratio for this kind of project.
- **Recommendation:** none. Worth preserving explicitly (see §4.3).

### 4.2 The real gaps are dead code, not untested logic

- **Location:** `src/maplibre/MapLibreLoader.ts:17` (`loadMapLibreFromCdn`), `src/index.ts`,
  `src/components/LayerSwitcherControl.ts` (80.53%)
- **Impact:** **Low**, but two of the three are removable rather than testable.
- **Observation:** `loadMapLibreFromCdn` shows 0% coverage because it is **never called** —
  `grep -rn loadMapLibreFromCdn` across the repo returns only its own definition (and a coverage
  HTML artifact). It defaults to `maplibre-gl@4.7.1` while `package.json` pins `^5.24.0`, so if
  anyone did use the documented escape hatch they would get a major version behind the bundled one,
  against a map built with the bundled `maplibregl`. Its doc comment also points at a CLAUDE.md
  section that doesn't exist (§1.2). `src/index.ts` at 0% is the `window.customCards` registration —
  trivially side-effecting, arguably not worth a test. `LayerSwitcherControl`'s uncovered lines are
  the `_measure()` geometry path, which needs real layout jsdom can't provide.
- **Recommendation:** *(small)* Delete `loadMapLibreFromCdn` and the `Window.maplibregl` global
  declaration with it; the bundling decision is settled and the function is a version-skew trap. If
  it must stay, pin its default to the same major as the dependency and add a test. Consider
  `coverage.exclude`-ing `src/index.ts` so the headline number reflects testable code.

### 4.3 CI runs the full gate but does not enforce coverage, and lint covers only `src`

- **Location:** `.github/workflows/test.yml`, `.github/workflows/release.yml`,
  `.github/workflows/hacs-validate.yml`, `package.json` scripts, `eslint.config.js`
- **Impact:** **Medium** — mostly for the release path.
- **Observation:** `test.yml` is well-formed: checkout, Node 20 with npm cache, then `npm ci` +
  typecheck + lint + test + build, on push to main/master and on every PR. Good. Gaps:
  - **No coverage gate.** `test:coverage` exists and is never run in CI, and `vite.config.ts` sets
    no `coverage.thresholds`. Today's 90.93% can erode with nothing noticing.
  - **`release.yml` does not run the test gate.** Pushing a `v*` tag goes straight to `npm ci` →
    `npm run build` → publish the GitHub Release asset. A tag cut from a commit that never passed
    (or that regressed after) CI ships to HACS users unverified. `passWithNoTests: true` in
    `vite.config.ts` compounds this: a config/glob mistake that collects zero tests is a silent
    green rather than a failure.
  - **`test.yml` has no `permissions:` block**, so it inherits the repository default token scope.
    `hacs-validate.yml` sets `contents: read` and `release.yml` sets `contents: write` — `test.yml`
    should be `contents: read` too.
  - **`npm run lint` is `eslint src`** — `test/`, `dev/`, `vite.config.ts` and `eslint.config.js`
    are never linted even though `tsconfig.json` type-checks `src`, `test`, `dev` *and*
    `vite.config.ts`. The two tools disagree on what the project is.
  - No formatter (no Prettier, no `.editorconfig`, no formatting rules in eslint). Line lengths
    range from ~80 to 208 characters within the same files; `CircleRenderService.ts:119` is a
    127-char signature. Cosmetic today, but it makes diffs noisier than they need to be.
- **Recommendation:** *(small)* Add `permissions: contents: read` to `test.yml`; widen lint to
  `eslint .` (with `dist/`, `coverage/`, `node_modules/` ignored — `dist/**` is already ignored);
  drop `passWithNoTests` or set a coverage threshold (`lines: 85`) and run `test:coverage` in CI;
  make `release.yml` depend on the test job (or re-run typecheck/lint/test before building). Adding
  Prettier is optional but would cost one dev dependency and one CI line.

---

## 5. Tooling, build, and dependencies

### 5.1 Command results on `1b7bc2d` — all green

- **Location:** repo-wide
- **Impact:** informational (positive).
- **Observation:**
  | Command | Result |
  |---|---|
  | `npm run typecheck` | pass — no output, no diagnostics |
  | `npm run lint` | pass — no output, zero errors/warnings |
  | `npm test` | pass — 33 files, 310 tests, 18.44s |
  | `npm run test:coverage` | pass — 90.93% stmts / 90.19% branch / 94.46% funcs / 90.93% lines |
  | `npm run build` | pass — 67 modules → `dist/nyxmap-card.js`, **1,693.92 kB** (365.80 kB gzip), 4.20s |
  `tsconfig.json` is strict *and* sets `noUncheckedIndexedAccess`, `forceConsistentCasingInFileNames`
  and `isolatedModules` — noticeably above baseline. The `resolve.conditions: ["browser"]` workaround
  in `vite.config.ts` (forcing Lit's browser build so `@lit-labs/ssr-dom-shim` doesn't leak into the
  bundle or the jsdom tests) is well-explained and correct.
- **Recommendation:** none.

### 5.2 `dist/` handling is correct, and the bundle-size story deserves an explicit note

- **Location:** `.gitignore`, `package.json`, `hacs.json`, `.github/workflows/release.yml`
- **Impact:** **Low.** Called out because the caller asked and because the answer is "already right".
- **Observation:** `dist/` is gitignored and `git ls-files dist` returns nothing — build output is
  **not** tracked, and is produced fresh in `release.yml` and attached to the GitHub Release, which
  `hacs.json`'s `filename: nyxmap-card.js` then points HACS at. That is the correct HACS pattern.
  `package.json` declares `main`/`module`/`files: ["dist"]` as if for npm publication, which this
  package is not — harmless but slightly misleading. The bundle is 1.69 MB raw / 366 kB gzip,
  essentially all `maplibre-gl` (three runtime deps: `maplibre-gl`, `lit`, `@turf/circle`). Vite
  emits no size warning here but 1.69 MB is above its default 500 kB chunk-size threshold; the
  build's `inlineDynamicImports: true` deliberately forces one file, which is the right call for a
  Lovelace resource. `@turf/circle` is pulled in for what `src/util/geo.ts`'s
  `circlePolygonCoordinates` needs — a whole dependency for one geodesic-circle function, worth a
  glance if bundle size ever becomes a complaint.
- **Recommendation:** *(small)* Document the deliberate single-file/bundled-MapLibre decision in
  CLAUDE.md as part of the §1.1 rewrite — several code comments already reference a "MapLibre
  bundling decision" that has no home. Optionally drop `main`/`module`/`files` from `package.json`
  or add `"private": true` to make the not-an-npm-package status explicit.

---

## 6. Correctness-adjacent structural issues

*(Not bugs in behaviour — these are structural/tooling hazards. The concurrent code review owns
behavioural defects.)*

### 6.1 A raw NUL byte in `ClusterRenderService.ts` makes git and ripgrep treat it as binary

- **Location:** `src/services/render/ClusterRenderService.ts:58`
- **Impact:** **Medium.** This file is the second-largest module in the repo and the one most likely
  to need a careful diff. Today `git diff` will report "Binary files differ" instead of showing
  changes, `git blame` is degraded, ripgrep (and therefore this repo's own search tooling) refuses
  to search it, and GitHub will not render a diff for it in a PR. It is effectively unreviewable
  through normal tooling.
- **Observation:** `file src/services/render/ClusterRenderService.ts` → `data` (every other tracked
  source file is ASCII/UTF-8). `LC_ALL=C grep -an '[^[:print:][:space:]]'` locates it in
  `pairKey()`: the separator in the template literal `` `${a}\0${b}` `` is a literal U+0000 byte
  embedded in the source, not an escape sequence. The code works — JS strings tolerate NUL and it is
  a deliberately collision-proof separator — but it should be written as an escape.
- **Recommendation:** *(small)* Replace the literal byte with `` `${a}\0${b}` `` (or a plain
  `":"`/`"|"` separator — HA entity ids contain neither). One-line change; restores the entire
  file to normal diff/search tooling. Optionally add a `.gitattributes` `*.ts text` entry so a
  recurrence is caught.

### 6.2 `z_index_offset` is parsed and editable but consumed by nothing

- **Location:** `src/configs/EntityConfig.ts:16,41,71`, `src/editor/EntityFormSchema.ts:35,60`,
  `src/components/NyxmapCardEditor.ts:48`
- **Impact:** **Low-Medium.** It is exposed as a numeric field in the *visual editor* labelled
  "Z-index offset". A user can set it, the config round-trips, and nothing happens — with no way to
  tell that from a bug in marker stacking.
- **Observation:** `grep -rn 'z_index_offset\|zIndexOffset' src` hits only the config parser, its
  test, and the editor schema/labels. No render service reads `zIndexOffset`. It is also absent
  from README's Entity options table, so it is undocumented *and* surfaced in the UI — the worst
  combination. It is presumably an upstream `ha-map-card` key carried over for config compatibility.
- **Recommendation:** *(small)* Either implement it (marker `z-index` in `MarkerFactory`) or remove
  it from `EntityFormSchema` and `LABELS` so it stays a silently-tolerated upstream key rather than
  an advertised control. Keeping it in `EntityConfig` for migration compatibility is fine and worth
  a one-line comment saying so.

---

## Prioritized shortlist

1. **Rewrite `CLAUDE.md`'s Project/Architecture preamble and prune the "Not yet ported" backlog**
   (§1.1). It is verbatim Phase 0 text that tells every future contributor there is no build, no
   tests, and a single file that does not exist — the single highest-cost inaccuracy in the repo,
   and the cheapest to fix.
2. **Fix the NUL byte in `ClusterRenderService.ts:58`** (§6.1). One character; restores `git diff`,
   `git blame`, ripgrep and PR review on a 360-line core module that is currently opaque to all of
   them.
3. **Extract the shared overlay lifecycle into one `OverlaySource` collaborator** (§2.1, §3.1).
   Removes five copies of the same ~60 lines and, more importantly, converts the "register for
   re-attach or your overlay vanishes on theme swap" invariant from a documented convention into a
   structural guarantee — do it before a sixth overlay type is added.
4. **Harden the release and lint gates** (§4.3): `permissions: contents: read` on `test.yml`, make
   `release.yml` run the test gate before publishing the HACS asset, widen `eslint` past `src`, and
   put a coverage threshold behind the 90.93% you already have.
5. **Fix the ten dangling `see CLAUDE.md §…` comments and the README/CLAUDE.md control-placement
   contradiction** (§1.2, §1.3). Follows naturally from item 1 and stops the remaining pointers from
   being treated as noise.
6. **Delete `loadMapLibreFromCdn`, and resolve `z_index_offset`** (§4.2, §6.2). Two small deletions
   of surface that currently promises behaviour the code does not deliver — one a version-skew trap
   pinned two majors behind, one a live control in the visual editor that does nothing.
7. **Lift the pure logic out of `NyxmapCard` and `ClusterRenderService`, and add conformance
   assertions for the `*Like` duck-types** (§2.2, §2.3, §2.4). Lower urgency — coverage is already
   high — but it moves style resolution and cluster grouping into `node`-environment unit tests and
   closes the only place where `tsc` is currently blind to MapLibre API drift.
