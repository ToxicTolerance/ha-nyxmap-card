import { describe, expect, it, vi } from "vitest";
import { EntityConfig } from "../../configs/EntityConfig";
import { StyleReattach } from "../../maplibre/StyleReattach";
import type { HomeAssistant } from "../../types/home-assistant";
import { createFakeMaplibreMap } from "../../../test/fakes/FakeMaplibreMap";
import { GeoJsonRenderService } from "./GeoJsonRenderService";
import { LayerRegistry } from "./LayerRegistry";

function hassWith(states: HomeAssistant["states"]): HomeAssistant {
  return { states, callWS: vi.fn(), language: "en" };
}

function entityWithGeoJson(id: string, geojson: unknown, attributes: Record<string, unknown> = {}): {
  entity: EntityConfig;
  hass: HomeAssistant;
} {
  const entity = EntityConfig.from({ entity: id, geojson } as never);
  const hass = hassWith({
    [id]: { entity_id: id, state: "on", attributes, last_changed: "", last_updated: "" },
  });
  return { entity, hass };
}

const POINT = { type: "Point", coordinates: [13.4, 52.52] };

describe("GeoJsonRenderService", () => {
  it("adds a source and fill/line/circle layers for an entity with resolvable geojson", () => {
    const map = createFakeMaplibreMap();
    const service = new GeoJsonRenderService(map as never, new StyleReattach(), new LayerRegistry(), vi.fn());
    const { entity, hass } = entityWithGeoJson("geo_location.demo", "geo_shape", { geo_shape: POINT });

    service.update([entity], hass);

    expect(map.addSource).toHaveBeenCalledWith(
      "geojson-geo_location.demo",
      expect.objectContaining({ type: "geojson", data: POINT }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "geojson-geo_location.demo-fill" }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "geojson-geo_location.demo-line" }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "geojson-geo_location.demo-circle" }));
    expect(service.has("geo_location.demo")).toBe(true);
  });

  it("skips entities without a geojson config", () => {
    const map = createFakeMaplibreMap();
    const service = new GeoJsonRenderService(map as never, new StyleReattach(), new LayerRegistry(), vi.fn());
    const entity = EntityConfig.from("geo_location.demo");

    service.update([entity], hassWith({}));

    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("skips entities whose configured attribute has no resolvable geojson", () => {
    const map = createFakeMaplibreMap();
    const service = new GeoJsonRenderService(map as never, new StyleReattach(), new LayerRegistry(), vi.fn());
    const { entity, hass } = entityWithGeoJson("geo_location.demo", "geo_shape", {});

    service.update([entity], hass);

    expect(map.addSource).not.toHaveBeenCalled();
    expect(service.has("geo_location.demo")).toBe(false);
  });

  it("calls setData on the existing source instead of re-adding it", () => {
    const map = createFakeMaplibreMap();
    const setData = vi.fn();
    map.getSource.mockReturnValue({ setData });
    const service = new GeoJsonRenderService(map as never, new StyleReattach(), new LayerRegistry(), vi.fn());
    const { entity, hass } = entityWithGeoJson("geo_location.demo", "geo_shape", { geo_shape: POINT });

    service.update([entity], hass);

    expect(setData).toHaveBeenCalledTimes(1);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("removes the source/layers, unregisters reattach + the layer switcher, and unwires clicks when a geojson drops out", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const layerRegistry = new LayerRegistry();
    const service = new GeoJsonRenderService(map as never, reattach, layerRegistry, vi.fn());
    const { entity, hass } = entityWithGeoJson("geo_location.demo", "geo_shape", { geo_shape: POINT });

    service.update([entity], hass);
    map.getSource.mockReturnValue({ setData: vi.fn() }); // simulate the source now existing
    service.update([], hassWith({}));

    expect(map.removeLayer).toHaveBeenCalledWith("geojson-geo_location.demo-fill");
    expect(map.removeLayer).toHaveBeenCalledWith("geojson-geo_location.demo-line");
    expect(map.removeLayer).toHaveBeenCalledWith("geojson-geo_location.demo-circle");
    expect(map.removeSource).toHaveBeenCalledWith("geojson-geo_location.demo");
    expect(map.off).toHaveBeenCalledWith("click", "geojson-geo_location.demo-fill", expect.any(Function));
    expect(reattach.has("geojson-geo_location.demo")).toBe(false);
    expect(layerRegistry.getOverlays().has("geojson-geo_location.demo")).toBe(false);
    expect(service.has("geo_location.demo")).toBe(false);
  });

  it("registers a StyleReattach factory that replays the most recent geometry after a style reload", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const service = new GeoJsonRenderService(map as never, reattach, new LayerRegistry(), vi.fn());
    const { entity, hass } = entityWithGeoJson("geo_location.demo", "geo_shape", { geo_shape: POINT });

    service.update([entity], hass);

    const freshMap = createFakeMaplibreMap();
    reattach.replayAll(freshMap as never);

    expect(freshMap.addSource).toHaveBeenCalledWith(
      "geojson-geo_location.demo",
      expect.objectContaining({ type: "geojson", data: POINT }),
    );
    expect(freshMap.addLayer).toHaveBeenCalledTimes(3);
  });

  it("removeAll() clears every tracked geojson shape", () => {
    const map = createFakeMaplibreMap();
    const service = new GeoJsonRenderService(map as never, new StyleReattach(), new LayerRegistry(), vi.fn());
    const a = entityWithGeoJson("a", "geo_shape", { geo_shape: POINT });
    const b = entityWithGeoJson("b", "geo_shape", { geo_shape: POINT });
    service.update([a.entity, b.entity], hassWith({ ...a.hass.states, ...b.hass.states }));

    service.removeAll();

    expect(service.has("a")).toBe(false);
    expect(service.has("b")).toBe(false);
  });

  describe("interactivity", () => {
    it("wires a click handler on each layer that calls onTap with the entity id", () => {
      const map = createFakeMaplibreMap();
      const onTap = vi.fn();
      const service = new GeoJsonRenderService(map as never, new StyleReattach(), new LayerRegistry(), onTap);
      const { entity, hass } = entityWithGeoJson("geo_location.demo", "geo_shape", { geo_shape: POINT });

      service.update([entity], hass);

      const clickCall = map.on.mock.calls.find(
        (c) => c[0] === "click" && c[1] === "geojson-geo_location.demo-fill",
      );
      expect(clickCall).toBeDefined();
      const handler = clickCall![2] as () => void;
      handler();

      expect(onTap).toHaveBeenCalledWith("geo_location.demo");
    });
  });

  describe("layer switcher integration", () => {
    it("registers an overlay entry for each shape it creates", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new GeoJsonRenderService(map as never, new StyleReattach(), layerRegistry, vi.fn());
      const { entity, hass } = entityWithGeoJson("geo_location.demo", "geo_shape", { geo_shape: POINT });

      service.update([entity], hass);

      const overlay = layerRegistry.getOverlays().get("geojson-geo_location.demo");
      expect(overlay?.label).toContain("geo_location.demo");
      expect(overlay?.group).toBe("geojson");
    });

    it("setVisible(map, false) hides all three layers via setLayoutProperty", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new GeoJsonRenderService(map as never, new StyleReattach(), layerRegistry, vi.fn());
      const { entity, hass } = entityWithGeoJson("geo_location.demo", "geo_shape", { geo_shape: POINT });
      service.update([entity], hass);

      const overlay = layerRegistry.getOverlays().get("geojson-geo_location.demo")!;
      overlay.setVisible(map, false);

      for (const suffix of ["fill", "line", "circle"]) {
        expect(map.setLayoutProperty).toHaveBeenCalledWith(
          `geojson-geo_location.demo-${suffix}`,
          "visibility",
          "none",
        );
      }
    });
  });
});
