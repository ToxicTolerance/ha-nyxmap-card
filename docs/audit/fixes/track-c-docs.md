# Track C — documentation accuracy (engineering audit §1.1, §1.2, §1.3)

**Baseline:** `1b7bc2d` (v0.9.1, `master`). **Files changed:** `CLAUDE.md`, `README.md`.
Nothing under `src/` was touched; no commit was made.

---

## 1. What changed

### `CLAUDE.md` — Project preamble rewritten (§1.1)

The old preamble (lines 5–44, byte-identical to the Phase 0 scaffold) was replaced. It now has:

- **Intro** — states the card element is `<nyxmap-card>`, a Lit 3 custom element built from
  TypeScript in `src/` and shipped as a single bundled ES module `dist/nyxmap-card.js`.
- **`### Toolchain`** — a table of the real npm scripts (`dev`, `build`/`build:watch`,
  `test`/`test:watch`/`test:coverage`, `lint`/`lint:fix`, `typecheck`), the Vite 6 / vitest 2 /
  TS 5.7 / eslint 9 stack, the strict-plus-`noUncheckedIndexedAccess` tsconfig bar, the three
  runtime deps, and what CI runs. Explicitly notes the `lint` (`eslint src`) vs. `tsconfig`
  (`src`, `test`, `dev`, `vite.config.ts`) scope mismatch, since that trips people up.
- **`### Dev loop`** — `npm run dev` → `dev/harness.html` + `dev/mock-hass.ts`; the
  `dev/plugin-example.*` pair; and the build-and-copy-to-`/config/www` path for testing in a real
  HA instance (replacing the old "copy `maplibre-map-card.js`" instruction).
- **`### MapLibre bundling`** — the bundled-not-CDN decision, `inlineDynamicImports`, the `?raw`
  CSS import and why (shadow root), the surviving-but-uncalled `loadMapLibreFromCdn()`, and the
  `dist/` → release-asset → `hacs.json` chain. This also gives the "MapLibre bundling decision"
  that `MapLibreLoader.ts:13` cites a real home (audit §5.2 recommendation).

### `CLAUDE.md` — Architecture directory map rewritten (§1.1)

The "banner-delimited sections in one file" framing is gone, replaced by a per-directory map of
`src/` (`index.ts`, `components/`, `configs/`, `services/`, `services/render/`, `maplibre/`,
`models/`, `editor/`, `util/`, `types/`). The stated *intent* — mirror upstream's module
boundaries to stay diffable — is preserved, because the layout still honours it. Two new
subsections:

- **`### Tests`** — colocation convention, `node` default environment with per-file
  `@vitest-environment jsdom` opt-in, `test/setup.ts`'s three shims, `FakeMaplibreMap` and why it
  is hand-rolled.
- **`### Config surface (relative to upstream ha-map-card)`** — the divergences only, with README
  named as the user-facing reference. Covers `map_style`/`map_style_dark` (incl. the keyless
  free-tier "Open risk to flag"), `map_styles`/`layer_switcher`, `projection` (the globe default
  and its rationale), `plugins`, and `z_index_offset`.

The four post-Phase-0 subsections (theme-swap invariant, visual config editor, JS plugin hook, map
control layout) were **kept as-is** per the audit's recommendation; only the control-layout section
got the addition described in §1.3 below.

### `CLAUDE.md` — porting backlog given a real home (§1.1)

`### Not yet ported` (which pointed at "the bottom of `maplibre-map-card.js`") is now a top-level
**`## Porting backlog (not yet ported from upstream ha-map-card)`** that declares itself the
backlog's home and names README's Roadmap as the user-facing mirror. Each item was re-checked
against the source (see §2):

- `tile_layers`/WMS and `geojson:` — **removed from the backlog**; both ship. Called out
  explicitly as "already ported, despite older comments implying otherwise" so the next reader
  doesn't re-add them.
- `history_date_selection` — **kept**, verified unimplemented.
- **Added** the WMS `history`/`TIME` sub-config, deferred by `LayerConfig` alongside the above.
- **Added** entity-valued `history_start`/`history_end`, unresolved by `HaMapUtilities.resolveTime`.

### `CLAUDE.md` — new `## Where older cross-references point` (§1.2 mitigation)

Since `src/` is off-limits this pass, CLAUDE.md now carries a table mapping the stale citations
("§5", "§5 'Open risk to flag'", "§5 'Layer switcher'", "the globe decision", "the MapLibre
bundling decision", "Phase 9" / "the phase plan") onto the sections that replaced them. Section
names were deliberately chosen so those phrases still resolve — "Open risk to flag", "Layer
switcher", "MapLibre bundling" and the globe rationale all appear verbatim in the new text. The
table says outright that it is a bridge and the comments should be updated.

### `README.md` (§1.3 + backlog sync)

- `cluster_markers` row: "adds a bottom-left 'Toggle grouping' map button" → "adds a 'Toggle
  grouping' map button … in the top-right column directly beneath the zoom/compass and 'Reset
  focus' buttons".
- Roadmap: extended to match CLAUDE.md's backlog (adds the WMS `TIME` parameter and the
  entity-id form of `history_start`/`history_end`).
- Closing line: "the full architecture notes and **phased plan**" → "…and the **porting
  backlog**" — the phased plan does not exist, the porting backlog now does.
- Swept the rest of README for control-position language. The `layer_switcher` row was already
  correct ("top-right, stacked directly beneath the zoom/compass and Reset focus / Toggle grouping
  controls"). The only other `bottom-left` occurrences are inside the plugin code examples
  (`ctx.map.addControl(..., "bottom-left")`), which are a plugin author's own choice, not a
  statement about the card's layout — left alone.

---

## 2. How each claim was verified

Every claim was checked against the tree at `1b7bc2d`, not taken from the audit.

| Claim | Verification |
|---|---|
| Scripts `dev`/`build`/`build:watch`/`test`/`test:watch`/`test:coverage`/`lint`/`lint:fix`/`typecheck` exist | read `package.json` |
| Version 0.9.1; Vite 6, vitest 2, TS 5.7, eslint 9; deps = `maplibre-gl` ^5.24, `lit` ^3.2, `@turf/circle` ^7.3 | read `package.json` |
| `lint` covers only `src`, tsconfig covers `src`/`test`/`dev`/`vite.config.ts` | `package.json` `"lint": "eslint src"` vs. `tsconfig.json` `include` |
| strict + `noUncheckedIndexedAccess` + `forceConsistentCasingInFileNames` + `isolatedModules` | read `tsconfig.json` |
| `npm run dev` opens `dev/harness.html`; lib build; `inlineDynamicImports` | read `vite.config.ts` (`server.open`, `build.lib`, `rollupOptions.output`) |
| Harness mounts a real card against a mocked hass | read `dev/main.ts` (`createMockHass` from `./mock-hass`), `dev/harness.html` |
| MapLibre bundled, CSS via `?raw`, `loadMapLibreFromCdn` uncalled | read `src/maplibre/MapLibreLoader.ts`; `git grep loadMapLibreFromCdn` hits only its definition |
| `dist/` untracked, produced by release workflow, pointed at by HACS | `.gitignore` has `dist/`; `git ls-files .github` shows `release.yml`; `hacs.json` `filename: nyxmap-card.js` |
| CI = typecheck → lint → test → build on push to main/master + PRs | read `.github/workflows/test.yml` |
| `src/` module map (directories and module names) | `git ls-files src` — 43 non-test `.ts` files across `components/ configs/ editor/ maplibre/ models/ services/ services/render/ types/ util/` + `index.ts` |
| `src/index.ts` registers `window.customCards` | read `src/index.ts` |
| 33 colocated test files; `src/**/*.test.ts` collected; `node` default env | `git ls-files 'src/**/*.test.ts' \| wc -l` = 33; `vite.config.ts` `test.include` / `environment: "node"` |
| jsdom opted into per file in ~10 files | `git grep -l "@vitest-environment" src \| wc -l` = 10 |
| `test/setup.ts` shims matchMedia, ResizeObserver, requestAnimationFrame | read `test/setup.ts` in full |
| `tile_layers`/WMS shipped | `src/configs/TileLayerConfig.ts`, `WmsLayerConfig.ts`, `src/services/render/TileLayersRenderService.ts` (+ its test) all exist and are tracked; README documents them |
| `geojson:` shipped | `src/configs/GeoJsonConfig.ts`, `src/models/GeoJson.ts`, `src/services/render/GeoJsonRenderService.ts` (+ tests) exist; README documents it |
| `history_date_selection` **not** shipped | `git grep -l history_date_selection` → `README.md` only; `git grep energy-date-selection src` → no hits |
| WMS `history`/`TIME` deferred | read `src/configs/LayerConfig.ts:12-15` (explicit deferral comment) |
| Entity-valued `history_start` unresolved | read `src/util/HaMapUtilities.ts:70-84` — `if (ENTITY_ID_RE.test(trimmed)) return null` |
| `z_index_offset` parsed but unread by renderers | `git grep -n 'z_index_offset\|zIndexOffset' src` → only `EntityConfig` (parse), `EntityFormSchema`/`NyxmapCardEditor` (editor UI), tests |
| Default styles are free/keyless (OpenFreeMap + CARTO) | read `src/configs/MapConfig.ts:10-14` |
| **All** card controls are top-right | `NyxmapCard.ts:380` NavigationControl `"top-right"`; `:388-394` Reset-focus `IconButtonControl` `"top-right"`; `:568` cluster toggle `"top-right"` |
| Layer switcher toggle is measured against the top-right column | read `LayerSwitcherControl._measure()` — queries `.maplibregl-ctrl-top-right`, sets `style.top`/`style.right`; and `LayerSwitcherControl.styles.ts:21,40` |
| Attribution is compact/bottom-right | `NyxmapCard.ts:378` `attributionControl: { compact: true }` (MapLibre's default corner is bottom-right) |
| v0.9.1 moved the switcher out of bottom-left | `CHANGELOG.md` `[0.9.1] → Changed`, first entry |

Toolchain commands were **not** re-run: two sibling agents are editing `src/` concurrently, so a
pass/fail result now would say nothing about `1b7bc2d`. Accordingly, no pass/fail or
coverage-percentage claim was written into `CLAUDE.md` — only that the scripts exist and what they
do, which is verifiable from config alone and stays true regardless of their work.

---

## 3. `src/` comment cross-references still needing updates (§1.2)

Not edited here — `src/` is owned by sibling agents this pass. Each is a comment-only, one-line
change. The CLAUDE.md sections they should point at now exist under the names below.

| File:line | Current text | Change to |
|---|---|---|
| `src/configs/MapConfig.ts:11` | `// (see CLAUDE.md §5 "Open risk to flag").` | `// (see CLAUDE.md "Config surface", map_style bullet — the open risk to flag).` |
| `src/configs/MapConfig.ts:115` | `Not an upstream key — see CLAUDE.md §5 "Layer switcher".` | `Not an upstream key — see CLAUDE.md "Config surface".` |
| `src/configs/MapConfig.ts:119` | `defaults to "globe" per CLAUDE.md's globe decision.` | `defaults to "globe" — see CLAUDE.md "Config surface", projection bullet.` |
| `src/configs/MapConfig.ts:122` | `Not an upstream key — see CLAUDE.md §5 "Layer switcher".` | `Not an upstream key — see CLAUDE.md "Config surface".` |
| `src/configs/EntityConfig.ts:27` | `(see CLAUDE.md §5 for keys that don't carry over 1:1)` | `(see CLAUDE.md "Config surface" for keys that don't carry over 1:1)` |
| `src/configs/EntityConfig.ts:28` | `Only display/marker fields are wired to rendering in Phase 1` | drop the phase reference; the sentence is also simply out of date — history, circles and geojson are all wired now |
| `src/configs/LayerConfig.ts:14` | `see CLAUDE.md's Phase 9 backlog` | `see CLAUDE.md's "Porting backlog"` |
| `src/util/HaMapUtilities.ts:66` | `aren't resolved here — see CLAUDE.md Phase 9.` | `aren't resolved here — see CLAUDE.md's "Porting backlog".` |
| `src/maplibre/MapLibreLoader.ts:13` | `see CLAUDE.md's "MapLibre bundling" decision` | unchanged text is now **correct** — CLAUDE.md has a `### MapLibre bundling` section. (If `loadMapLibreFromCdn` is deleted per audit §4.2, the comment goes with it.) |
| `src/maplibre/StyleReattach.ts:7` | `So it survives theme swaps. See CLAUDE.md.` | already resolves (the theme-swap invariant section, kept and unrenamed); optionally name it: `See CLAUDE.md, "The one non-obvious invariant".` |
| `src/services/render/TileLayersRenderService.ts:28` | `deliberately not hand-rolled BBOX math (see CLAUDE.md / the phase plan).` | drop the pointer and keep the rationale inline: `deliberately not hand-rolled BBOX math.` (README's Tile/WMS section documents it for users.) |
| `src/components/NyxmapCardEditor.ts:63` | `see CLAUDE.md for the rationale.` | already resolves ("Visual config editor" section, kept); optionally name it. |
| `src/components/NyxmapCard.ts:386-387` | `the layer switcher now lives bottom-left and attribution bottom-right, so this corner is theirs to share.` | **factually wrong since v0.9.1** — the switcher is top-right. Replace with: `the layer switcher's toggle stacks beneath this column (it measures against it), and attribution sits bottom-right.` This is the §1.3 in-code half; CLAUDE.md and README are already fixed. |

---

## 4. Deliberately not done

- **No `src/` edits at all**, including the one factually-wrong comment
  (`NyxmapCard.ts:386-387`) — sibling agents own that tree this pass. It is row 13 above.
- **No `CHANGELOG.md` edit.** The file does use an `## [Unreleased]` heading (currently empty), so
  a note would fit the convention, but the working file list for this track is CLAUDE.md /
  README.md / hacs.json / docs, and a concurrent agent editing the same heading would conflict.
  Suggested entry for whoever lands this: under `[Unreleased]` → `### Changed` —
  "Rewrote CLAUDE.md's Project/Architecture preamble against the real repo (Vite/vitest toolchain,
  `src/` module map) and gave the porting backlog a home; corrected README's `cluster_markers`
  control position."
- **No `hacs.json` change.** Checked: `name`, `render_readme`, and `filename: nyxmap-card.js` all
  match the release asset built by `release.yml`. Nothing stale.
- **Did not run `typecheck`/`lint`/`test`/`build`** — see the note at the end of §2.
- **Did not document the audit's other findings as if fixed.** The overlay-lifecycle duplication
  (§2.1), the `*Like` duck-type casts (§2.2) and the NUL byte (§6.1) are unmentioned in CLAUDE.md;
  they are structural recommendations, not current behaviour.
- **Did not re-word the four post-Phase-0 Architecture subsections**, which the audit found
  accurate.

---

## 5. Follow-ups needed once sibling work lands

Written against committed behaviour at `1b7bc2d`. These sections will need a re-read after the
concurrent tracks merge:

1. **Card teardown / camera behaviour** (code review §1, §2, §5, §6). CLAUDE.md's Architecture map
   describes `NyxmapCard` as owning "lifecycle, map construction, service orchestration" — that
   stays true — but nothing in CLAUDE.md currently documents teardown or `focus_follow` re-fit
   semantics, so there is no stale text to fix. If the fix changes user-visible `focus_follow`
   behaviour, **README's `focus_follow` row** (currently: "`refocus` re-centers on every update;
   `contains` only re-fits when `focus_entity` leaves the current view") must be re-checked.
2. **`StyleReattach.replayAll` error isolation** (code review §3). Two places assert the current
   guarantee: CLAUDE.md's JS-plugin-hook section says "Each `setup(ctx)` runs in try/catch so a
   throwing plugin can't take the card down", and README's plugin note implies the same. If
   isolation is extended into `replayAll` (and/or `registerControl`, audit §3.2), both should be
   restated as the stronger, now-true guarantee.
3. **If `OverlaySource` is extracted** (audit §2.1), CLAUDE.md's theme-swap-invariant section and
   the plugin-hook section's "`registerOverlay` … is a direct generalization of
   `GeoJsonRenderService._upsert`'s trio" both name the current three-registration shape and would
   need rewording.
4. **If `loadMapLibreFromCdn` is deleted** (audit §4.2), drop its sentence from CLAUDE.md's
   "MapLibre bundling" section.
5. **If `z_index_offset` is removed from the visual editor** (audit §6.2), adjust the
   "Config surface" bullet, which currently says it is parsed and round-trips but is read by no
   render service.
