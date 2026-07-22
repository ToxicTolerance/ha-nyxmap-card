# Track B — extension-point resilience

> **Superseded — historical record.** This is a point-in-time artifact of the
> v0.9.1 audit, kept for provenance. Much of it has since been fixed and parts
> of it are now simply wrong about the current tree (it predates the CI
> coverage gate, the whole-project lint, the removal of `loadMapLibreFromCdn`,
> and the `OverlaySource` extraction it recommends). Do **not** read it as a
> description of the project today — see `CHANGELOG.md` for what landed and
> `CLAUDE.md` for the current architecture and backlog.

- **Baseline:** `1b7bc2d` (v0.9.1, `master`)
- **Findings addressed:** code-review §3, code-review §10, engineering-audit §3.2
- **Files touched (the full allowed set):** `src/maplibre/StyleReattach.ts`,
  `src/maplibre/StyleReattach.test.ts`, `src/maplibre/PluginHost.ts`,
  `src/maplibre/PluginHost.test.ts`, `src/types/nyxmap-plugin.d.ts`, and this document.
  No other file was modified.

The theme is the same across all three: nyxmap's extension points hand the `style.load` handler
arbitrary third-party code, and every failure path in that code was previously either fatal to the
handler or silently swallowed. Each fix makes a failure local and audible.

---

## CR §3 — `StyleReattach.replayAll` had no per-factory isolation

**What changed.** `src/maplibre/StyleReattach.ts:46-55` — `replayAll` was a bare
`for (const factory of this.factories.values()) factory(map);`. It is now:

```ts
for (const [id, factory] of [...this.factories]) {
  try {
    factory(map);
  } catch (err) {
    console.error(`[nyxmap-card] style reattach failed for "${id}":`, err);
  }
}
```

plus a doc comment (`StyleReattach.ts:30-45`) explaining both halves, since neither is obvious
from the three lines of code.

**Why.** `NyxmapCard`'s `"style.load"` handler calls `replayAll` and then does everything else
that matters after it — plugin activation, tile layers, entities/clusters, geojson, history,
initial view. An exception from any single factory propagated out and skipped all of it. A plugin
that hands `registerOverlay` a layer spec MapLibre rejects is harmless on the first load (the add
happens inside `activate()`, which is try/caught) but its *factory* is now in the registry, so from
the second style load onward every theme swap silently wiped tile layers, circles, geojson shapes
and history trails. The documented "a misbehaving plugin can't take the card down" guarantee
(`PluginHost.ts:56`) did not survive a theme swap.

The snapshot (`[...this.factories]`) is the second half of the finding: `factories` is a live `Map`
being iterated, so a factory calling `register()` with a fresh id during replay was visited in the
same pass — a self-registering factory loops forever. Snapshotting also makes mid-replay
`unregister()` well-defined rather than dependent on `Map` iterator ordering.

A factory that throws is **kept registered**, not evicted. The finding floats "optionally evict a
factory that throws twice"; I deliberately didn't, because the common real cause is transient (an
add racing a not-yet-loaded style), and evicting would turn a recoverable per-swap failure into a
permanent one with no way back short of a page reload. The console error already names the id.

**Tests** (`src/maplibre/StyleReattach.test.ts`, four new cases on top of the existing four):

- *"isolates a throwing factory so the remaining ones still replay"* — factories registered before
  and after the thrower both receive the map; `replayAll` doesn't throw; the error names the id.
- *"keeps a throwing factory registered so a later replay retries it"* — pins the no-eviction
  decision above.
- *"snapshots the registry so a factory registering during replay isn't visited in the same pass"* —
  a self-registering factory runs exactly once and its new registration is deferred to the next
  pass. Against the old live-`Map` iteration this test hangs rather than fails.
- *"tolerates a factory that unregisters another factory mid-replay"*.

---

## CR §10 — a colliding plugin overlay id clobbered the internal overlay

**What changed.** `src/maplibre/PluginHost.ts:148-169` — `_registerOverlay` now **rejects** instead
of warning-and-proceeding, on two conditions:

1. `src/maplibre/PluginHost.ts:157-162` — the id starts with a prefix owned by the card's own render
   services. The list is `RESERVED_OVERLAY_ID_PREFIXES` at `PluginHost.ts:19`:
   `history-`, `circle-`, `geojson-`, `tile-layer-`, `wms-layer-`.
2. `src/maplibre/PluginHost.ts:164-169` — `reattach.has(id) || layerRegistry.getOverlays().has(id)`.

Both log a `console.warn` naming the id and suggesting `plugin:<id>`, then `return` before anything
is registered.

**Why.** The old code warned and continued, which is the worst of both: `_addOverlay` bails early on
`map.getSource(id)` so the plugin's source/layers were *not* added, while `reattach.register` and
`layerRegistry.registerOverlay` (both plain `Map.set`) *did* overwrite the internal service's
entries. After the next theme swap the internal overlay was never re-added, the internal service's
next `_upsert` found the plugin's source and `setData`'d trail geometry into it, and the layer
switcher toggled layer ids that no longer existed — neither side recovering without a reload.
Rejecting makes registration all-or-nothing.

The reserved-prefix check is not redundant with the collision check, and this is the non-obvious
part: `PluginHost.activate()` runs from the `"style.load"` handler *before* the render services'
first `update()`, so at plugin-registration time `reattach.has("history-device_tracker.phone")` is
still `false`. A plugin claiming that id would pass the `has()` check and then be clobbered by the
history service moments later — the collision in the reverse direction. Only a static prefix
reservation catches it.

`src/types/nyxmap-plugin.d.ts:50-70` documents the requirement on the plugin-author surface (it was
previously only a soft "prefer a namespaced id" hint plus README prose): the reserved prefix list,
that a collision is rejected rather than merged, and that `ctx.reattach` — the advanced escape hatch
— performs **no** such check, so hand-rolled ids must be prefixed by the author.

**Tests** (`src/maplibre/PluginHost.test.ts`):

- *"rejects an overlay id that collides with an already-registered overlay"* — pre-seeds `reattach`
  and `layerRegistry` with an internal-style entry, then asserts nothing was added to the map, the
  internal `LayerRegistry` label is intact, and `replayAll` still runs the *internal* factory.
- *"rejects the reserved built-in overlay id %s even before the owning service registers it"* — an
  `it.each` over all five reserved prefixes, asserting `addSource` is untouched and neither registry
  gained the id. This is the case the collision check alone cannot cover.

---

## Engineering §3.2 — `PluginHost`'s silently-lost failure path

**What changed.** `src/maplibre/PluginHost.ts:95` + `:100-113` — `ctx.registerControl` was a bare
passthrough `(control, position) => this.deps.map.addControl(control, position)`. It is now
`_registerControl`, wrapping `addControl` in the same try/catch + `console.error` shape used for
`plugin.setup()` at `PluginHost.ts:57`:

```ts
console.error("[nyxmap-card] plugin registerControl() failed:", err);
```

**Why.** `map.addControl()` synchronously invokes the control's `onAdd()`, which is third-party code
at exactly the same trust level as `setup()` — but it was the one plugin entry point with no
isolation. Via the global-array path a throw was absorbed by the `setup()` catch (though it aborted
the rest of that plugin's setup with only a generic message); via the `nyxmap-map-ready` event path
`setup` is *not* wrapped by design, so a throwing control escaped through the event dispatch and
into the `"style.load"` handler. The audit's word for this is "silently lost" — the failure either
vanished into the wrong catch or took the handler down, and in neither case did the console say
`registerControl`.

**Test** (`src/maplibre/PluginHost.test.ts`, *"isolates a control whose onAdd throws instead of
letting it escape"*): makes the fake map's `addControl` throw, asserts `activate()` doesn't throw,
that the plugin's `setup()` continues past the failed call, and that the error message names
`registerControl()`.

---

## Deliberately not done

- **Engineering §2.1 / §3.1 — the `OverlaySource` extraction.** Explicitly deferred by the task
  brief. The three-registrations-by-hand duplication (`addSource`/`addLayer` +
  `reattach.register` + `layerRegistry.registerOverlay`, plus the paired unregisters) across the
  five overlay producers is real, and folding it into one type would make the collision fix above
  enforceable for *internal* services too rather than only at the plugin boundary. Not touched here;
  it spans files outside this track's allowed set.
- **§3.1's `LayerRegistry.unregister` split** into `unregisterBaseStyle`/`unregisterOverlay`.
  `src/services/render/LayerRegistry.ts` is outside the allowed file set. Noted as a blocker, not
  attempted. Low impact today (no id currently exists in both categories), but the new
  `layerRegistry.getOverlays().has(id)` collision check in `PluginHost` is written against
  `getOverlays()` specifically rather than a would-be generic `has()`, so it stays correct after
  that split.
- **Evicting a repeatedly-throwing reattach factory.** Reasoned against above — turns a transient
  failure permanent.
- **§3.2's `injectStyle` URL-vs-CSS heuristic** (`PluginHost.ts:120-140`). The audit is right that
  it misclassifies both ways (a brace-free raw CSS string reads as a URL; a `{`-carrying CSS URL
  reads as raw CSS), but the recommended fix is an **API change** — an explicit
  `injectStyle({url}) / injectStyle({css})` overload on the public plugin contract. That is a
  feature change to a published surface, not the failure-observability fix this track was scoped
  to, and it would need a README/plugin-docs update in files outside the allowed set. Left alone.
- **`ctx.reattach` guard rails** (§3.2 observation 3). The escape hatch still performs no collision
  check by design — adding one to `StyleReattach.register` would change behaviour for the internal
  services that legitimately re-register the same id on every update. Documented as an author
  responsibility in `nyxmap-plugin.d.ts` instead.

---

## Verification

Two sibling agents were editing `src/components/NyxmapCard.ts` and
`src/services/render/InitialViewRenderService.ts` concurrently while these commands ran. **Every**
failure below is in those two sibling-owned files mid-edit; nothing in Track B's four files fails.

### `npm run typecheck`

```
> ha-nyxmap-card@0.9.1 typecheck
> tsc --noEmit

src/components/NyxmapCard.ts(105,14): error TS2339: Property '_refreshOverlays' does not exist on type 'NyxmapCard'.
```

The single error is a sibling agent's in-flight edit to `NyxmapCard.ts` (Track A/C territory — a
call to a method not yet written). No error in `StyleReattach.ts`, `PluginHost.ts`, their tests, or
`nyxmap-plugin.d.ts`.

### `npm run lint`

```
> ha-nyxmap-card@0.9.1 lint
> eslint src
```

Clean — no output.

### `npm test`

```
 Test Files  2 failed | 31 passed (33)
      Tests  4 failed | 317 passed (321)
   Start at  12:54:25
   Duration  9.80s (transform 2.19s, setup 237ms, collect 4.87s, tests 2.45s, environment 29.43s, prepare 9.98s)
```

The two failing files are `src/components/NyxmapCard.test.ts` (10 failures, all from the
`_refreshOverlays` typecheck error above) and
`src/services/render/InitialViewRenderService.test.ts` (3 failures) — both sibling-owned and
mid-edit. Re-running the suite with exactly those two files excluded:

```
 Test Files  31 passed (31)
      Tests  272 passed (272)
   Start at  12:54:59
   Duration  8.50s (transform 1.89s, setup 283ms, collect 4.11s, tests 1.39s, environment 20.54s, prepare 8.77s)
```

And the two Track B files in isolation (`npx vitest run src/maplibre/StyleReattach.test.ts
src/maplibre/PluginHost.test.ts`):

```
 ✓ src/maplibre/StyleReattach.test.ts (8 tests) 26ms
 ✓ src/maplibre/PluginHost.test.ts (18 tests) 57ms

 Test Files  2 passed (2)
      Tests  26 passed (26)
   Start at  12:53:59
   Duration  2.13s (transform 140ms, setup 36ms, collect 163ms, tests 83ms, environment 1.34s, prepare 355ms)
```

Baseline was 310 tests; Track B adds 11 (4 to `StyleReattach`, 7 to `PluginHost` — the reserved-
prefix `it.each` counts as 5).

`npm run test:coverage` was not run, per the task brief. Nothing was committed; all changes are in
the working tree.
