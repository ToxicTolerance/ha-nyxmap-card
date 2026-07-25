# Remediation — the 2026-07-25 code review

**Date:** 2026-07-25 · **Base:** v0.10.3 (`77e613e`) · **Branch:** `claude/code-review-documentation-1uwejg`

Every finding in [`2026-07-25-code-review.md`](2026-07-25-code-review.md) is now
resolved. This is the record of what changed and — more usefully — *why each fix
took the shape it did*, including one approach that was designed, started, and
abandoned because it would have introduced a new bug.

## Method

The constraint was "fix these without creating new ones", so:

- **One finding per commit.** Each is independently revertable; none depends on
  another landing first.
- **Every behavioural fix has a regression test that was demonstrated to fail
  against the unfixed source.** Not "a test was added" — the old implementation
  was stashed back in and the new tests were watched to fail, then the fix
  restored and watched to pass. That check caught one test whose premise was
  wrong (see F3(a) below).
- **The full gate ran after every commit**: `typecheck` → `lint --max-warnings 0`
  → the whole suite → `build`.

## Result

| | Before | After |
|---|---|---|
| Tests | 479 | **505** (+26) |
| Test files | 37 | 37 |
| Statements / lines | 99.0% | 99.1% |
| Branches | 92.0% | **92.8%** |
| Functions | 97.5% | 97.5% |
| `typecheck` · `lint --max-warnings 0` · `build` | pass | pass |

Bundle: 1,721.61 kB raw / 375.31 kB gzip. No runtime dependency changed.

## Fix-by-fix

| # | Severity | Fix | Commit |
|---|---|---|---|
| F1 | High | WMS `SRS`/`CRS` selected from the version | `Fix WMS requests naming the wrong coordinate-reference parameter` |
| F2 | High | `OverlaySource` keeps visibility intent across `remove()` | `Keep an overlay's visibility intent when the overlay is removed` |
| F5 | Low | dots-only trails draw from a single sample | `Draw a dots-only history trail that has a single sample` |
| F3(c) | Medium | `dataKey` on accuracy circles | `Stop re-pushing unchanged accuracy-circle geometry on every hass tick` |
| F3(b)+F6 | Medium+Low | switcher item arrays reused; callbacks bound once; observer attach retried | `Stop the layer switcher forcing a layout on every hass tick…` + `Bind the layer switcher's callback props once` |
| F3(a) | Medium | `--card-background-color` read coalesced per frame | `Coalesce the card's --card-background-color read to one per frame` |
| F4 | Low | dead `LngLatBounds` return removed | `Drop EntitiesRenderService's unused bounds computation` |
| F7 | Low | resolved by design decision — see below | (F2 commit) |
| F8 | Nit | doc counts corrected | (review commit) |

---

### F1 — WMS `SRS` vs `CRS`

`crsParamName(version)` now picks the parameter, and exactly one of the two is
ever sent.

Two decisions worth recording. The version is parsed **numerically** rather than
compared as a string: Leaflet's own `L.TileLayer.WMS` does `version >= "1.3"`,
which is correct for the four WMS versions that exist but inverts for any future
two-digit minor — cheap to avoid. And an unparseable version yields `NaN`, every
comparison is false, and it lands on `SRS`, which is the same side the `1.1.1`
default lands on.

Parameterized over `1.0.0 / 1.1.0 / 1.1.1 / 1.3 / 1.3.0 / 2.0.0 / absent /
garbage`; the five pre-1.3 cases fail against the old builder. `README.md` now
documents the behaviour.

### F2 — overlay visibility intent

**The first approach was wrong, and finding that out is the most useful part of
this document.**

The review proposed pruning the card's `_appliedOverlayVisibility` for ids no
longer in the registry. That was implemented — and then reverted — because
tracing the callback graph to write the test showed two problems:

1. **It doesn't fire on the path that matters.** The realistic trigger is
   clustering absorbing an entity and releasing it again. That path runs
   `ClusterRenderService._recompute()` → `onVisibilityChange()` →
   `NyxmapCard._resyncEntityMarkers()` → `_refreshCircles()`, which never calls
   `_syncOverlayVisibility()`. The prune would have sat there doing nothing.
2. **Wiring it into that path recurses infinitely.** In the diff loop
   `entry.setVisible(map, visible)` runs *before* `_appliedOverlayVisibility.set`,
   and the cluster overlay's `setVisible` synchronously calls back into
   `_resyncEntityMarkers()`. A nested sync would therefore see the same
   desired ≠ applied mismatch, call `setVisible` again, and recurse. Making it
   safe needed a re-entrancy guard — new state, guarding a new hazard, to fix an
   old bug.

The actual fix is one line in `OverlaySource.remove()`: **stop deleting the
`visibility` entry.** A re-added overlay then builds itself hidden, the card's
existing bookkeeping is already consistent with that, and no card code changes
at all. It also makes every overlay producer agree on one rule — intent survives
removal — which `ClusterRenderService._enabled` and `PluginHost._overlayVisible`
already followed; `OverlaySource` was the odd one out.

Two regression tests, both failing against the old code: the invariant at the
`OverlaySource` level (via `CircleRenderService`), and the full absorb/release
round trip through the real card and its rendered switcher.

### F3(c) — circle `dataKey`

Keyed on centre + radius, which is the entire input to the polygon. Colour and
fill-opacity are deliberately **excluded** — they live in layer paint, not in the
source data, and `paintKey` already handles them. A test pins exactly that: a
recolour still pushes paint and does not push data.

**Deliberately not done:** memoizing the `@turf/circle` call. `build()` runs
before the `dataKey` comparison, so the polygon is still recomputed each update.
That is bounded pure JS; a geometry cache is a stale-data bug waiting to happen
for a much smaller saving than the `setData` (and GPU re-tessellation) now
skipped.

### F3(b) + F6 — switcher layout and observer

> **This fix was initially incomplete and shipped that way.** Browser profiling
> afterwards showed `getBoundingClientRect` unchanged at 3 per tick: `render()`
> also passed three freshly-created arrow functions, which fail Lit's identity
> check on their own, so the switcher updated every tick regardless of the
> memoized arrays. Fixed by binding them once; see
> [`2026-07-25-profile.md`](2026-07-25-profile.md). The array-identity test
> passed the whole time, because it asserted the change rather than the outcome.

Landed together, as the review said they had to be. `_baseStyleItems()` /
`_overlayItems()` now return the previous array when the contents serialize
identically, so Lit's identity check reports no change and the switcher doesn't
update at all on an inert `hass` tick. That removed the accidental safety net
that was masking F6, so `updated()` now retries `_observeParent()` rather than
only re-measuring.

The comparison stays correct because every field the switcher renders is inside
the compared value — a new overlay, a re-label, a base-style switch or a
visibility toggle all produce a new array. Tested in both directions.

### F3(a) — theme flag

Coalesced to at most one `getComputedStyle` per animation frame, cancelled in
`disconnectedCallback` alongside the existing `_resizeRaf`.

An element's **first** update still reads synchronously. Deferring that one too
would paint a frame of light-styled controls on a dark theme before correcting
itself — trading a visible regression for a performance win, which is precisely
what this pass was not allowed to do.

This is where the fail-first discipline paid: the initial "first update is
synchronous" test failed, and the bug was in the test. Lit performs an initial
update on connection, so the shared fixture's first update had already happened
before `setConfig`. The test now uses a freshly created element. The production
behaviour was right all along — but the test as first written would have
"passed" for the wrong reason if the assertion had been looser.

### F4 — dead bounds

`update()`'s `LngLatBounds` return had no reader; auto-fit is served entirely by
`InitialViewRenderService`, which derives its own bounds. Removing it lets
`MapLibreGlLike` drop to the one thing the service needs (a `Marker`
constructor), so fakes and future implementers no longer have to supply a
constructor that only fed dead work. `FakeLngLatBounds` went with it;
`InitialViewRenderService`'s tests model MapLibre's *accessor-style* bounds
separately, which is the shape that actually matters and is untouched.

### F7 — visibility maps never pruned: closed as by-design

**No behaviour change, deliberately.** The review flagged that
`_overlayVisibility` and `PluginHost._overlayVisible` grow without pruning.
Pruning `_overlayVisibility` would have been an active bug: it holds the user's
*intent*, and F2 established that intent has to outlive exactly these temporary
removals — dropping it would silently forget that a circle was hidden every time
the camera zoomed out far enough to cluster its entity.

So the resolution is the rule, now documented in `CLAUDE.md` and on the field
itself: **intent survives removal, everywhere.** Growth is bounded by the number
of distinct overlay ids a card has ever shown, and a teardown drops the services
outright.

---

## Docs updated

- `CLAUDE.md` — coverage figures and which file is now the binding branch-
  coverage constraint (`LayerSwitcherControl` moved 71% → ~86%, so `NyxmapCard`
  is now lowest); `dataKey` now covers circles as well as raster; the new
  "visibility outlives removal" rule recorded with `OverlaySource`.
- `README.md` — WMS `SRS`/`CRS` behaviour documented against `options.version`.
- `CHANGELOG.md` — entry under Unreleased.
- `2026-07-25-code-review.md` — a status column, so the report reads as resolved
  rather than open.

## What this pass did not cover

No review of the `*.styles.ts` files or `dev/`, and no dependency/supply-chain pass (the 0.10.2 audit ran
`npm audit`; this one did not).

Both caveats that originally stood here — "not profiled" and "never run against
a real Home Assistant instance" — are now closed. See
[`2026-07-25-profile.md`](2026-07-25-profile.md): the F3 findings were measured
against the real bundle in Chromium, then against HA core 2024.3.3 with the card
installed as a Lovelace resource beside four ordinary HA cards. That caught an
ineffective fix, and established that F3(b)'s forced layout is real in a
dashboard (111 layouts per 300 state changes, 10 with the switcher ablated) after
the isolated benchmark had appeared to disprove it.
