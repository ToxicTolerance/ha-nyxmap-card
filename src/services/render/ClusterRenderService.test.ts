import { describe, expect, it, vi } from "vitest";
import { EntityConfig } from "../../configs/EntityConfig";
import { StyleReattach } from "../../maplibre/StyleReattach";
import type { HomeAssistant } from "../../types/home-assistant";
import { createFakeMaplibreMap, type FakeMaplibreMap } from "../../../test/fakes/FakeMaplibreMap";
import { ClusterRenderService } from "./ClusterRenderService";
import { LayerRegistry } from "./LayerRegistry";

function hassWith(states: HomeAssistant["states"]): HomeAssistant {
  return { states, callWS: vi.fn(), language: "en" };
}

function entityAt(id: string, lng: number, lat: number): EntityConfig {
  return EntityConfig.from({ entity: id, fixed_x: lng, fixed_y: lat } as never);
}

/** Pulls out the plain 2-arg `on(event, handler)` registration (zoomend/
 * moveend/data), as opposed to the layer-scoped 3-arg click registration. */
function findHandler(map: FakeMaplibreMap, event: string): (arg?: unknown) => void {
  const call = map.on.mock.calls.find((c) => c[0] === event && c.length === 2);
  if (!call) throw new Error(`no 2-arg "${event}" handler registered`);
  return call[1] as (arg?: unknown) => void;
}

function findLayerHandler(map: FakeMaplibreMap, event: string, layerId: string): (arg?: unknown) => void {
  const call = map.on.mock.calls.find((c) => c[0] === event && c[1] === layerId);
  if (!call) throw new Error(`no "${event}" handler registered for layer "${layerId}"`);
  return call[2] as (arg?: unknown) => void;
}

describe("ClusterRenderService", () => {
  it("adds a cluster source and both bubble layers for entities with a resolvable position", () => {
    const map = createFakeMaplibreMap();
    const service = new ClusterRenderService(map as never, new StyleReattach(), new LayerRegistry(), vi.fn());

    service.update([entityAt("a", 1, 2), entityAt("b", 3, 4)], hassWith({}));

    expect(map.addSource).toHaveBeenCalledWith(
      "entity-clusters",
      expect.objectContaining({ type: "geojson", cluster: true, clusterRadius: 50, clusterMaxZoom: 14 }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "entity-clusters-circle", type: "circle" }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "entity-clusters-count", type: "symbol" }),
    );
  });

  it("uses the given radius/maxZoom for the cluster source instead of the defaults", () => {
    const map = createFakeMaplibreMap();
    const service = new ClusterRenderService(map as never, new StyleReattach(), new LayerRegistry(), vi.fn());

    service.update([entityAt("a", 1, 2)], hassWith({}), { radius: 30, maxZoom: 16 });

    expect(map.addSource).toHaveBeenCalledWith(
      "entity-clusters",
      expect.objectContaining({ clusterRadius: 30, clusterMaxZoom: 16 }),
    );
  });

  /** getSource() needs to actually reflect add/removeSource() here (unlike
   * other tests in this file, which only ever call update() once against a
   * source that never existed): a rebuild only manifests correctly if a
   * post-teardown getSource() genuinely reports "gone", same as real
   * MapLibre — a single static mockReturnValue can't distinguish "before"
   * from "after" the removeSource() call these tests exercise. */
  function fakeMapWithLiveSourceTracking(): FakeMaplibreMap {
    const map = createFakeMaplibreMap();
    let exists = false;
    map.getSource.mockImplementation(() => (exists ? { setData: vi.fn(), getClusterExpansionZoom: vi.fn() } : undefined));
    map.addSource.mockImplementation(() => {
      exists = true;
    });
    map.removeSource.mockImplementation(() => {
      exists = false;
    });
    return map;
  }

  it("rebuilds the source when radius/maxZoom changes on a later update()", () => {
    const map = fakeMapWithLiveSourceTracking();
    const service = new ClusterRenderService(map as never, new StyleReattach(), new LayerRegistry(), vi.fn());

    service.update([entityAt("a", 1, 2)], hassWith({}), { radius: 50, maxZoom: 14 });
    service.update([entityAt("a", 1, 2)], hassWith({}), { radius: 30, maxZoom: 14 });

    expect(map.removeSource).toHaveBeenCalledWith("entity-clusters");
    expect(map.addSource).toHaveBeenLastCalledWith(
      "entity-clusters",
      expect.objectContaining({ clusterRadius: 30, clusterMaxZoom: 14 }),
    );
  });

  it("does not rebuild the source when radius/maxZoom is unchanged across updates", () => {
    const map = fakeMapWithLiveSourceTracking();
    const service = new ClusterRenderService(map as never, new StyleReattach(), new LayerRegistry(), vi.fn());

    service.update([entityAt("a", 1, 2)], hassWith({}), { radius: 30, maxZoom: 14 });
    service.update([entityAt("a", 1, 2)], hassWith({}), { radius: 30, maxZoom: 14 });

    expect(map.removeSource).not.toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalledTimes(1);
  });

  it("excludes entities with an unresolved position or geojson.hide_marker from the fed FeatureCollection", () => {
    const map = createFakeMaplibreMap();
    const service = new ClusterRenderService(map as never, new StyleReattach(), new LayerRegistry(), vi.fn());
    const hidden = EntityConfig.from({
      entity: "c",
      fixed_x: 5,
      fixed_y: 6,
      geojson: { hide_marker: true },
    } as never);
    const unresolved = EntityConfig.from("d");

    service.update([entityAt("a", 1, 2), hidden, unresolved], hassWith({}));

    const [, source] = map.addSource.mock.calls[0] as [string, { data: { features: unknown[] } }];
    const ids = (source.data.features as Array<{ properties: { entityId: string } }>).map(
      (f) => f.properties.entityId,
    );
    expect(ids).toEqual(["a"]);
  });

  it("calls setData on the existing source instead of re-adding it", () => {
    const map = createFakeMaplibreMap();
    const setData = vi.fn();
    map.getSource.mockReturnValue({ setData, getClusterExpansionZoom: vi.fn() });
    const service = new ClusterRenderService(map as never, new StyleReattach(), new LayerRegistry(), vi.fn());

    service.update([entityAt("a", 1, 2)], hassWith({}));

    expect(setData).toHaveBeenCalledTimes(1);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("registers a StyleReattach factory that replays the most recent data after a style reload", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const service = new ClusterRenderService(map as never, reattach, new LayerRegistry(), vi.fn());

    service.update([entityAt("a", 1, 2)], hassWith({}));

    const freshMap = createFakeMaplibreMap();
    reattach.replayAll(freshMap as never);

    expect(freshMap.addSource).toHaveBeenCalledWith(
      "entity-clusters",
      expect.objectContaining({ type: "geojson" }),
    );
    expect(freshMap.addLayer).toHaveBeenCalledTimes(2);
  });

  it("removeAll() unregisters reattach/layer registry and removes the source/layers", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const layerRegistry = new LayerRegistry();
    const service = new ClusterRenderService(map as never, reattach, layerRegistry, vi.fn());
    service.update([entityAt("a", 1, 2)], hassWith({}));
    map.getSource.mockReturnValue({ setData: vi.fn(), getClusterExpansionZoom: vi.fn() });

    service.removeAll();

    expect(map.removeLayer).toHaveBeenCalledWith("entity-clusters-circle");
    expect(map.removeLayer).toHaveBeenCalledWith("entity-clusters-count");
    expect(map.removeSource).toHaveBeenCalledWith("entity-clusters");
    expect(reattach.has("entity-clusters")).toBe(false);
    expect(layerRegistry.getOverlays().has("entity-clusters")).toBe(false);
  });

  describe("layer switcher integration", () => {
    it("registers a single 'Clusters' overlay entry", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new ClusterRenderService(map as never, new StyleReattach(), layerRegistry, vi.fn());

      service.update([entityAt("a", 1, 2)], hassWith({}));

      const overlay = layerRegistry.getOverlays().get("entity-clusters");
      expect(overlay?.label).toBe("Clusters");
      expect(overlay?.group).toBe("cluster");
    });

    it("setVisible(map, false) hides both layers and clears getHiddenEntityIds()", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new ClusterRenderService(map as never, new StyleReattach(), layerRegistry, vi.fn());
      service.update([entityAt("a", 1, 2), entityAt("b", 3, 4)], hassWith({}));

      // "b" is absorbed into a cluster per the stubbed querySourceFeatures,
      // once a real recompute (zoomend) runs.
      map.querySourceFeatures.mockReturnValue([{ properties: { entityId: "a" } }]);
      findHandler(map, "zoomend")();
      expect(service.getHiddenEntityIds().has("b")).toBe(true);

      const overlay = layerRegistry.getOverlays().get("entity-clusters")!;
      overlay.setVisible(map, false);

      expect(map.setLayoutProperty).toHaveBeenCalledWith("entity-clusters-circle", "visibility", "none");
      expect(map.setLayoutProperty).toHaveBeenCalledWith("entity-clusters-count", "visibility", "none");
      expect(service.getHiddenEntityIds().size).toBe(0);
    });
  });

  describe("hidden-entity recompute", () => {
    it("recomputes hidden ids on zoomend by diffing querySourceFeatures against fed entity ids", () => {
      const map = createFakeMaplibreMap();
      const onVisibilityChange = vi.fn();
      const service = new ClusterRenderService(map as never, new StyleReattach(), new LayerRegistry(), onVisibilityChange);
      service.update([entityAt("a", 1, 2), entityAt("b", 3, 4)], hassWith({}));
      onVisibilityChange.mockClear();

      // Only "a" reported as unclustered => "b" is absorbed into a bubble.
      map.querySourceFeatures.mockReturnValue([{ properties: { entityId: "a" } }]);
      findHandler(map, "zoomend")();

      expect(service.getHiddenEntityIds()).toEqual(new Set(["b"]));
      expect(onVisibilityChange).toHaveBeenCalledTimes(1);

      // Recomputing again with an unchanged result must not re-fire the callback.
      findHandler(map, "moveend")();
      expect(onVisibilityChange).toHaveBeenCalledTimes(1);
    });
  });

  describe("cluster click-to-expand", () => {
    it("expands via getClusterExpansionZoom + easeTo on cluster-circle click", async () => {
      const map = createFakeMaplibreMap();
      const getClusterExpansionZoom = vi.fn().mockResolvedValue(9);
      map.getSource.mockReturnValue({ setData: vi.fn(), getClusterExpansionZoom });
      const service = new ClusterRenderService(map as never, new StyleReattach(), new LayerRegistry(), vi.fn());
      service.update([entityAt("a", 1, 2)], hassWith({}));

      const clickHandler = findLayerHandler(map, "click", "entity-clusters-circle");
      clickHandler({ features: [{ properties: { cluster_id: 7 }, geometry: { coordinates: [1, 2] } }] });
      await Promise.resolve();
      await Promise.resolve();

      expect(getClusterExpansionZoom).toHaveBeenCalledWith(7);
      expect(map.easeTo).toHaveBeenCalledWith({ center: [1, 2], zoom: 9 });
    });
  });
});
