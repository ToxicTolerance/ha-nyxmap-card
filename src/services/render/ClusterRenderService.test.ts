// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EntityConfig } from "../../configs/EntityConfig";
import type { HomeAssistant } from "../../types/home-assistant";
import { createFakeMaplibreGl, createFakeMaplibreMap, type FakeMaplibreMap, FakeMarker } from "../../../test/fakes/FakeMaplibreMap";
import { ClusterRenderService } from "./ClusterRenderService";
import { LayerRegistry } from "./LayerRegistry";

function hassWith(states: HomeAssistant["states"] = {}): HomeAssistant {
  return { states, callWS: vi.fn(), language: "en" };
}

/** Entities carry fixed lng/lat; the fake map's identity projection turns
 * those directly into screen pixels, so `x`/`y` here are effectively "px". */
function entityAt(id: string, x: number, y: number, size?: number): EntityConfig {
  return EntityConfig.from({ entity: id, fixed_x: x, fixed_y: y, ...(size !== undefined ? { size } : {}) } as never);
}

interface BubbleInternal {
  inner: HTMLElement;
  marker: FakeMarker;
  ids: Set<string>;
  count: number;
  centroid: [number, number];
}

function bubbles(service: ClusterRenderService): Map<string, BubbleInternal> {
  return (service as unknown as { _bubbles: Map<string, BubbleInternal> })._bubbles;
}

function makeService(map: FakeMaplibreMap, layerRegistry = new LayerRegistry(), onChange = vi.fn()) {
  return new ClusterRenderService(map as never, createFakeMaplibreGl(), layerRegistry, onChange);
}

function findHandler(map: FakeMaplibreMap, event: string): () => void {
  const call = map.on.mock.calls.find((c) => c[0] === event);
  if (!call) throw new Error(`no "${event}" handler registered`);
  return call[1] as () => void;
}

const flushFrame = () => new Promise((r) => setTimeout(r, 0));

describe("ClusterRenderService", () => {
  it("groups two entities whose marker circles overlap into a single bubble and hides both", () => {
    const map = createFakeMaplibreMap();
    const service = makeService(map);

    // 10px apart, default size 48 → touch distance 48 → well within → merge.
    service.update([entityAt("a", 0, 0), entityAt("b", 10, 0)], hassWith());

    expect(bubbles(service).size).toBe(1);
    const bubble = [...bubbles(service).values()][0]!;
    expect(bubble.count).toBe(2);
    expect([...service.getAbsorbed().keys()].sort()).toEqual(["a", "b"]);
  });

  it("leaves entities whose circles do not overlap as individual markers", () => {
    const map = createFakeMaplibreMap();
    const service = makeService(map);

    // 100px apart, size 48 → touch distance 48 → far outside → no merge.
    service.update([entityAt("a", 0, 0), entityAt("b", 100, 0)], hassWith());

    expect(bubbles(service).size).toBe(0);
    expect(service.getAbsorbed().size).toBe(0);
  });

  it("groups transitively: A touches B, B touches C, but A does not touch C → one group of 3", () => {
    const map = createFakeMaplibreMap();
    const service = makeService(map);

    // 0–40 and 40–80 each within touch (48*0.95=45.6); 0–80 (80) is not.
    service.update([entityAt("a", 0, 0), entityAt("b", 40, 0), entityAt("c", 80, 0)], hassWith());

    expect(bubbles(service).size).toBe(1);
    expect([...bubbles(service).values()][0]!.count).toBe(3);
    expect([...service.getAbsorbed().keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("breaks a chain that would sprawl past the spread cap into separate bubbles", () => {
    const map = createFakeMaplibreMap();
    const service = makeService(map);

    // Six markers in a row, 40px apart: every neighbouring pair overlaps (40 <
    // 45.6), so pure single-linkage would fuse all six into one bubble spanning
    // 200px — five times a bubble's own diameter, anchored at x=100 where it
    // covers the entities in the middle rather than sitting between any of
    // them. The cap (3 x 48 = 144px) refuses the merge that would cross it.
    service.update(
      [0, 40, 80, 120, 160, 200].map((x, i) => entityAt(`e${i}`, x, 0)),
      hassWith(),
    );

    const groups = [...bubbles(service).values()];
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) expect(g.count).toBeLessThan(6);
    // Every entity is still accounted for: the chain is partitioned, not
    // thinned out.
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(6);
  });

  it("keeps a tight blob wider than one bubble in a single group", () => {
    const map = createFakeMaplibreMap();
    const service = makeService(map);

    // 3x3 grid at 40px pitch: 113px diagonal, inside the 144px cap. The cap is
    // there to stop viewport-wide chains, not to fragment a genuine pile-up.
    const entities = [0, 40, 80].flatMap((x, i) =>
      [0, 40, 80].map((y, j) => entityAt(`e${i}${j}`, x, y)),
    );
    service.update(entities, hassWith());

    expect(bubbles(service).size).toBe(1);
    expect([...bubbles(service).values()][0]!.count).toBe(9);
  });

  it("anchors a bubble between its members regardless of how they are bunched up", () => {
    const map = createFakeMaplibreMap();
    const service = makeService(map);

    // Four in a knot at x≈0 plus one at x=44, all one group. The arithmetic
    // mean of the five is x≈8.8 — sitting on the knot, with the fifth member
    // stranded a bubble-and-a-half away. The middle of the footprint is x=22.
    service.update(
      [
        entityAt("a", 0, 0),
        entityAt("b", 2, 1),
        entityAt("c", 4, 0),
        entityAt("d", 2, -1),
        entityAt("e", 44, 0),
      ],
      hassWith(),
    );

    expect(bubbles(service).size).toBe(1);
    const bubble = [...bubbles(service).values()][0]!;
    expect(bubble.count).toBe(5);
    expect(bubble.centroid[0]).toBeCloseTo(22, 6);
    // Equidistant from the two extremes, which the mean is emphatically not.
    expect(Math.abs(bubble.centroid[0] - 0)).toBeCloseTo(Math.abs(bubble.centroid[0] - 44), 6);
  });

  it("anchors a bubble in member SCREEN space, not in lng/lat space", () => {
    const map = createFakeMaplibreMap();
    // A deliberately nonlinear projection — as both Web Mercator (log latitude)
    // and the default globe really are. y = lat^2/40, so lat 0 -> y 0 and
    // lat 40 -> y 40: 40px apart on screen, inside the merge threshold.
    map.project.mockImplementation((lngLat: [number, number]) => ({
      x: lngLat[0],
      y: (lngLat[1] * lngLat[1]) / 40,
    }));
    map.unproject.mockImplementation((point: [number, number]) => ({
      lng: point[0],
      lat: Math.sqrt(point[1] * 40),
    }));
    const service = makeService(map);

    service.update([entityAt("a", 0, 0), entityAt("b", 0, 40)], hassWith());

    const bubble = [...bubbles(service).values()][0]!;
    // Screen midpoint is y=20, which is lat sqrt(800) ~ 28.28 — NOT the lng/lat
    // mean of 20, which would render 8px above where the eye expects it.
    expect(bubble.centroid[1]).toBeCloseTo(Math.sqrt(800), 6);
    expect(bubble.marker.getLngLat()[1]).toBeCloseTo(Math.sqrt(800), 6);
    // The absorbed markers spring toward that same point.
    expect(service.getAbsorbed().get("a")![1]).toBeCloseTo(Math.sqrt(800), 6);
  });

  it("does not cluster at or above cluster_max_zoom regardless of distance", () => {
    const map = createFakeMaplibreMap();
    map.getZoom.mockReturnValue(15);
    const service = makeService(map);

    service.update([entityAt("a", 0, 0), entityAt("b", 5, 0)], hassWith(), { maxZoom: 14 });

    expect(bubbles(service).size).toBe(0);
    expect(service.getAbsorbed().size).toBe(0);
  });

  it("keeps an already-grouped pair grouped between the merge and split thresholds (hysteresis)", () => {
    const map = createFakeMaplibreMap();
    const service = makeService(map);

    // First frame: 40px apart → merges (below 45.6 merge threshold).
    service.update([entityAt("a", 0, 0), entityAt("b", 40, 0)], hassWith());
    expect(bubbles(service).size).toBe(1);

    // Now 50px apart: past the 45.6 merge threshold but below the 55.2 split
    // threshold — without hysteresis it would split; with it, it stays grouped.
    service.update([entityAt("a", 0, 0), entityAt("b", 50, 0)], hassWith());
    expect(bubbles(service).size).toBe(1);

    // 60px apart: past the split threshold → finally splits.
    service.update([entityAt("a", 0, 0), entityAt("b", 60, 0)], hassWith());
    expect(bubbles(service).size).toBe(0);
    expect(service.getAbsorbed().size).toBe(0);
  });

  it("recomputes on a settle event (moveend) after the projection changes", () => {
    const map = createFakeMaplibreMap();
    const service = makeService(map);
    service.update([entityAt("a", 0, 0), entityAt("b", 100, 0)], hassWith());
    expect(bubbles(service).size).toBe(0);

    // Simulate the camera moving the two points on top of each other.
    map.project.mockImplementation(() => ({ x: 0, y: 0 }));
    findHandler(map, "moveend")();

    expect(bubbles(service).size).toBe(1);
  });

  it("regroups only at camera settle, not on every continuous move frame", () => {
    const map = createFakeMaplibreMap();
    makeService(map);
    // Only settle events drive a regroup — recomputing mid-gesture would make
    // the merge/split spring animate against a moving camera (janky). No
    // continuous "move" handler should be registered.
    const events = map.on.mock.calls.map((c) => c[0]);
    expect(events).toContain("moveend");
    expect(events).toContain("zoomend");
    expect(events).not.toContain("move");
  });

  it("click-to-expand eases to the group centroid and a deeper zoom", () => {
    const map = createFakeMaplibreMap();
    map.getZoom.mockReturnValue(10);
    const service = makeService(map);
    service.update([entityAt("a", 0, 0), entityAt("b", 40, 0)], hassWith());

    const bubble = [...bubbles(service).values()][0]!;
    bubble.inner.dispatchEvent(new Event("click"));

    expect(map.easeTo).toHaveBeenCalledTimes(1);
    const arg = map.easeTo.mock.calls[0]![0] as { center: [number, number]; zoom: number };
    expect(arg.center).toEqual([20, 0]); // midpoint of [0,0] and [40,0]
    expect(arg.zoom).toBeGreaterThan(10);
  });

  it("click-to-expand never zooms past cluster_max_zoom, even for co-located entities", () => {
    const map = createFakeMaplibreMap();
    map.getZoom.mockReturnValue(10);
    const service = makeService(map);
    // Byte-identical positions: no zoom will ever separate them, so the old
    // "+6 levels" fallback threw the whole map away to reveal two markers still
    // exactly on top of each other. cluster_max_zoom is the ceiling now — at it,
    // clustering is off and both render individually, which is the most a zoom
    // can achieve here.
    service.update([entityAt("a", 5, 5), entityAt("b", 5, 5)], hassWith(), { maxZoom: 12 });

    [...bubbles(service).values()][0]!.inner.dispatchEvent(new Event("click"));

    const arg = map.easeTo.mock.calls[0]![0] as { zoom: number };
    expect(arg.zoom).toBeLessThanOrEqual(12);
    expect(arg.zoom).toBeGreaterThan(10);
  });

  it("click-to-expand stops short of zooming a group's own members off screen", () => {
    const map = createFakeMaplibreMap();
    map.getZoom.mockReturnValue(10);
    // A short, wide card: only 120px of height to play with.
    map.getCanvas.mockReturnValue({ clientWidth: 800, clientHeight: 120 });
    const service = makeService(map);
    // Two markers 40px apart vertically. Separating them wants ~0.64 levels,
    // but the group's footprint is already 40 + 48 = 88px of the 120px
    // available, so the fit ceiling (log2(120/88) ~ 0.45) binds first.
    service.update([entityAt("a", 0, 0), entityAt("b", 0, 40)], hassWith());

    [...bubbles(service).values()][0]!.inner.dispatchEvent(new Event("click"));

    const arg = map.easeTo.mock.calls[0]![0] as { zoom: number };
    expect(arg.zoom).toBeGreaterThan(10);
    expect(arg.zoom).toBeLessThan(10.65);
  });

  it("removeAll() removes every bubble, clears hidden ids, and unregisters the overlay", () => {
    const map = createFakeMaplibreMap();
    const layerRegistry = new LayerRegistry();
    const service = makeService(map, layerRegistry);
    service.update([entityAt("a", 0, 0), entityAt("b", 10, 0)], hassWith());
    const bubble = [...bubbles(service).values()][0]!;

    service.removeAll();

    expect(bubble.marker.remove).toHaveBeenCalled();
    expect(bubbles(service).size).toBe(0);
    expect(service.getAbsorbed().size).toBe(0);
    expect(layerRegistry.getOverlays().has("entity-clusters")).toBe(false);
  });

  describe("layer switcher integration", () => {
    it("registers a single 'Clusters' overlay entry", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = makeService(map, layerRegistry);

      service.update([entityAt("a", 0, 0), entityAt("b", 10, 0)], hassWith());

      const overlay = layerRegistry.getOverlays().get("entity-clusters");
      expect(overlay?.label).toBe("Clusters");
      expect(overlay?.group).toBe("cluster");
    });

    it("setVisible(false) removes bubbles and clears hidden ids; setVisible(true) regroups", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const onChange = vi.fn();
      const service = makeService(map, layerRegistry, onChange);
      service.update([entityAt("a", 0, 0), entityAt("b", 10, 0)], hassWith());
      const overlay = layerRegistry.getOverlays().get("entity-clusters")!;

      overlay.setVisible(map, false);
      expect(bubbles(service).size).toBe(0);
      expect(service.getAbsorbed().size).toBe(0);

      overlay.setVisible(map, true);
      expect(bubbles(service).size).toBe(1);
      expect(service.getAbsorbed().size).toBe(2);
    });
  });

  describe("merge/split animation", () => {
    it("a newly formed bubble starts hidden then transitions in", async () => {
      const map = createFakeMaplibreMap();
      const service = makeService(map);
      service.update([entityAt("a", 0, 0), entityAt("b", 10, 0)], hassWith());
      const bubble = [...bubbles(service).values()][0]!;

      // Synchronously after creation it carries the collapsed state...
      expect(bubble.inner.classList.contains("nyxmap-anim-out")).toBe(true);
      // ...and the double-rAF (stubbed as chained setTimeout(0)) transitions it in.
      await flushFrame();
      await flushFrame();
      expect(bubble.inner.classList.contains("nyxmap-anim-out")).toBe(false);
    });

    it("a dispersing bubble animates out before its marker is removed", () => {
      const map = createFakeMaplibreMap();
      const service = makeService(map);
      service.update([entityAt("a", 0, 0), entityAt("b", 10, 0)], hassWith());
      const bubble = [...bubbles(service).values()][0]!;

      // Pull the two entities far apart → the bubble dissolves.
      service.update([entityAt("a", 0, 0), entityAt("b", 100, 0)], hassWith());
      expect(bubble.inner.classList.contains("nyxmap-anim-out")).toBe(true);
      expect(bubble.marker.remove).not.toHaveBeenCalled();

      // Completing the transition unmounts it.
      bubble.inner.dispatchEvent(new Event("transitionend"));
      expect(bubble.marker.remove).toHaveBeenCalledTimes(1);
    });
  });
});

// Not a behavioural test: a guard on the source itself. pairKey()'s separator
// used to be a *literal* U+0000 byte pasted into the template literal rather
// than an escape, which made git report "Binary files differ" for this module
// (no diff, no blame, no GitHub PR view) and made ripgrep — and therefore the
// repo's own search tooling — skip it entirely. Cheap to reintroduce by
// accident, so it's pinned here rather than left to `.gitattributes`.
describe("source hygiene", () => {
  it("no tracked source file contains a raw NUL byte", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        return /\.(ts|js|json|md|css)$/.test(e.name) ? [p] : [];
      });

    const offenders = walk(join(process.cwd(), "src")).filter((f) =>
      readFileSync(f, "utf8").includes(String.fromCharCode(0)),
    );

    expect(offenders).toEqual([]);
  });
});
