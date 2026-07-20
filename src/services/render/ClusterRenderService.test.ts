// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EntityConfig } from "../../configs/EntityConfig";
import type { HomeAssistant } from "../../types/home-assistant";
import { createFakeMaplibreGl, createFakeMaplibreMap, type FakeMaplibreMap, FakeMarker } from "../../../test/fakes/FakeMaplibreMap";
import { ClusterRenderService, computeExpansionZoom } from "./ClusterRenderService";
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

  it("click-to-expand eases to the group centroid and a deeper zoom", () => {
    const map = createFakeMaplibreMap();
    map.getZoom.mockReturnValue(10);
    const service = makeService(map);
    service.update([entityAt("a", 0, 0), entityAt("b", 40, 0)], hassWith());

    const bubble = [...bubbles(service).values()][0]!;
    bubble.inner.dispatchEvent(new Event("click"));

    expect(map.easeTo).toHaveBeenCalledTimes(1);
    const arg = map.easeTo.mock.calls[0]![0] as { center: [number, number]; zoom: number };
    expect(arg.center).toEqual([20, 0]); // mean of [0,0] and [40,0]
    expect(arg.zoom).toBeGreaterThan(10);
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

describe("computeExpansionZoom", () => {
  it("zooms in at least one level even when members are already nearly separated", () => {
    const members = [
      { xy: { x: 0, y: 0 }, size: 48 },
      { xy: { x: 100, y: 0 }, size: 48 },
    ];
    expect(computeExpansionZoom(members, 10, 22)).toBe(11);
  });

  it("zooms in further for a tighter group and caps at maxZoom", () => {
    const members = [
      { xy: { x: 0, y: 0 }, size: 48 },
      { xy: { x: 1, y: 0 }, size: 48 },
    ];
    expect(computeExpansionZoom(members, 21, 22)).toBe(22);
  });
});
