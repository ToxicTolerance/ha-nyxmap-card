# Audit status / handoff

**Date:** 2026-07-21 · **Commit:** `1b7bc2d` (v0.9.1, branch `master`, clean tree)

Running note so this work can be resumed in a later session. Updated as steps complete.

## What this is

Two reusable review subagents were created, then pointed at the whole repository to
produce a written audit for later iteration.

## Step 1 — Agent definitions written ✅

Both are project-scoped (checked in, available to any future session in this repo):

- [.claude/agents/code-reviewer.md](../../.claude/agents/code-reviewer.md) — hunts
  **defects only**: correctness, lifecycle/cleanup leaks, the `StyleReattach`
  style-swap invariant, async ordering, untrusted config input, test gaps. Requires a
  concrete failure scenario per finding and a Confirmed/Plausible confidence flag.
- [.claude/agents/software-engineer.md](../../.claude/agents/software-engineer.md) —
  **structural health**: module boundaries and drift from the upstream `ha-map-card`
  layout, duplication, extension-point ergonomics (PluginHost / StyleReattach /
  LayerRegistry), testability, tooling/CI, and documentation accuracy. Findings are
  weighted by what they cost the project, closing with a prioritized shortlist.

Both are `model: opus`, read-mostly (Read/Grep/Glob/Bash/Write/Edit), and instructed
to document rather than fix.

**Known gotcha:** the agent registry loads at session start, so these two were *not*
selectable by name in the session that created them. They will be from the next
session onward. The audits below were run by inlining the same briefs into
`general-purpose` agents instead — equivalent instructions, different dispatch.

## Step 2 — Audits complete ✅

Two agents ran in parallel against commit `1b7bc2d`, each writing its own file in
this directory:

| Agent | Output file | Status |
| --- | --- | --- |
| code-reviewer brief | [code-review-findings.md](code-review-findings.md) | 19 findings + verified-clean list |
| software-engineer brief | [engineering-audit.md](engineering-audit.md) | 6 themes + prioritized shortlist |

Both were told to run the real `npm run typecheck` / `lint` / `test` (plus `build`
and `test:coverage` for the engineering pass) and report actual output. Both
**reported all green** at `1b7bc2d` — typecheck clean, lint clean, 310 tests across
33 files passing, coverage 90.93%. That is the agents' report; it was not re-run
independently, so treat it as unverified until someone runs the suite themselves.

**Caveat on provenance:** both agents were killed by an API spend limit immediately
after writing their files, so neither produced a final chat summary. The files
themselves are complete (they end with proper conclusions), but no agent got to
re-check its own work.

### Independently verified since

- **NUL byte in `ClusterRenderService.ts:58` — confirmed.** `file` reports the
  module as `data`, and `grep -P '\x00'` locates a literal U+0000 inside `pairKey()`'s
  template literal. Git and ripgrep both treat this 360-line core module as binary,
  so it has no usable `git diff`, `git blame`, or in-repo search. This is the
  cheapest high-value fix on either list.

## Finding already confirmed before dispatch

**CLAUDE.md is substantially stale.** It states: *"There is currently no build
tooling, package manifest, or test suite in this repo — it is a single-file custom
element (`maplibre-map-card.js`)"* and warns against assuming `npm run build`/`test`
exist. In reality the repo has `package.json` v0.9.1 with Vite 6 + vitest 2 +
TypeScript 5.7 + eslint 9, working `build` / `test` / `test:coverage` / `lint` /
`typecheck` scripts, and a `src/` tree of ~40 modules each with a colocated
`.test.ts`. The single-file custom element is gone.

This matters more than a stray typo: the same document tells contributors that the
"Not yet ported" backlog lives *at the bottom of `maplibre-map-card.js`*, a file that
no longer exists — so the porting backlog has no discoverable home. The
software-engineer pass was briefed to map how far this staleness spreads through
CLAUDE.md, README.md, CHANGELOG.md and hacs.json.

## Step 3 — Fix wave 1 complete ✅ (2026-07-21)

Three agents ran in parallel with **disjoint file ownership** (no agent could edit
another's files; ownership held — the modified set matched the briefs exactly). Each
wrote its own write-up in [fixes/](fixes/):

| Track | Findings fixed | Write-up |
| --- | --- | --- |
| A — card lifecycle & camera | code review §1, §2, §4, §5, §6, §11 | [track-a-card-lifecycle.md](fixes/track-a-card-lifecycle.md) |
| B — extension points | code review §3, §10 · engineering §3.2 | [track-b-extension-points.md](fixes/track-b-extension-points.md) |
| C — documentation accuracy | engineering §1.1, §1.2 (partial), §1.3 | [track-c-docs.md](fixes/track-c-docs.md) |

**Gate re-run on the settled tree after all three finished** (not taken from the
agents' own reports — each ran mid-flight while siblings were editing, so their
individual numbers were noise): `npm run typecheck` clean, `npm run lint` clean,
`npm test` **33 files / 332 tests passing** (up from 310), `npm run build` succeeds.
Changes are uncommitted in the working tree.

Notable corrections made *against* the audit's own text, by checking source:

- Track C found `tile_layers`/WMS and `geojson:` are **already shipped** — they were
  removed from the porting backlog rather than carried over. Two genuinely-deferred
  items were added in their place (WMS `history`/`TIME` sub-config; entity-valued
  `history_start`/`history_end`).
- Track C found CLAUDE.md was **right** and README wrong on control placement (all
  three controls are added `"top-right"`); README was fixed, not CLAUDE.md.
- Track B found the §10 collision check can't be purely dynamic: `activate()` runs
  from `style.load` *before* the render services' first `update()`, so a runtime
  `reattach.has(...)` returns `false` at plugin-registration time. Needed a static
  reserved-prefix list too.

Deliberately deferred by the agents (each documented with rationale): engineering
§2.1's `OverlaySource` extraction; the full `focus_follow` entity-state diff in
`updated()` (would suppress legitimate non-positional updates); `LayerRegistry`
unregister split; the `injectStyle` URL-vs-CSS rework (the audit's fix is a
public-API change, needs a decision not a patch).

## Merged next steps (for whoever picks this up)

Items 1–5 below are **done** (see Step 3). The rest are unfixed.

Ordered by value-per-effort, merging both lists:

1. **NUL byte in `ClusterRenderService.ts:58`** (engineering §6.1). One character.
   Restores diff/blame/search on a core module. Verified above.
2. **Rewrite CLAUDE.md's stale preamble** (engineering §1.1, and the pre-dispatch
   finding below). Highest-cost inaccuracy in the repo; misleads every contributor
   and every future agent session, including about where the porting backlog lives.
3. **Card teardown** (code review §1 + §2, both High). `disconnectedCallback()` never
   calls `map.remove()` — WebGL contexts, workers and listeners leak per card — and
   the `ResizeObserver` it *does* disconnect is never re-observed, so a re-parented
   card stops tracking resizes. These are one change and want one test.
4. **`StyleReattach.replayAll` isolation** (code review §3 + engineering §2.1/§3.1 —
   *the clearest overlap between the two audits*). A single throwing factory aborts
   the whole `style.load` handler, so the documented "a plugin can't take the card
   down" guarantee fails from the second style load onward. The defect fix is a
   try/catch plus snapshotting the map; the structural fix is extracting the shared
   overlay lifecycle into one `OverlaySource` collaborator, which turns the
   re-attach invariant from a convention into a structural guarantee. Do the
   try/catch now, the extraction before a sixth overlay type is added.
5. **`_ready` not cleared on `setStyle()`** (code review §4, High). Updates landing
   mid-swap call `addSource` on an unloaded style, which MapLibre throws on by
   design.
6. **`focus_follow: refocus` re-fits on every `hass` change** (code review §5, High)
   — the camera fights the user. Same gate drives full reconciliation including
   clustering's O(n²) scan, so fixing it is a general win.
7. **Single-entity fit slams to max zoom** (code review §6, High). Hits the default
   stub config, i.e. the most common possible setup.
8. **Surface that promises nothing** — `display: state` (code review §8),
   `z_index_offset` (engineering §6.2), `loadMapLibreFromCdn` (engineering §4.2).
   Each is either implemented or removed; leaving them advertised-but-inert is the
   worst option.
9. **CI/lint gates** (engineering §4.3) and the remaining Medium/Low defects
   (code review §7, §9–18), then the test gaps in §19 — which are what let items
   3–7 stand in the first place.

## Wave 2 — planned, not yet dispatched

Grouped again by disjoint file ownership:

- **Small isolated defects** — NUL byte in `ClusterRenderService.ts:58` (engineering
  §6.1, verified above), `colorFromString` negative hue (§17), `transitionend`
  settling a marker animation early (§18), tile-layer state keyed by list index
  (§16), `z_index_offset` decision (engineering §6.2).
- **Visual editor** — `display: "state"` offered but never rendered (§8), a
  `map_styles` entry without `map_style` blanking the map (§13), renaming an entity
  dropping YAML-only keys (§14), card-level fields that can't be cleared (§15).
- **History** — one failing fetch discarding every trail permanently (§7), history
  fetched once per style load and never refreshed (§12).
- **Doc follow-ups carried over from Track C** — the 13 source-comment
  cross-references listed in `fixes/track-c-docs.md` §3 (including
  `NyxmapCard.ts:386-387`, which is factually wrong, not merely dangling); restate
  CLAUDE.md's "a throwing plugin can't take the card down" as the stronger guarantee
  Track B's isolation now provides; re-check README's `focus_follow` row against
  Track A's camera change; the suggested `[Unreleased]` CHANGELOG entry.
