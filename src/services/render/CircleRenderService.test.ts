import { describe, expect, it, vi } from "vitest";
import { EntityConfig } from "../../configs/EntityConfig";
import { StyleReattach } from "../../maplibre/StyleReattach";
import type { HomeAssistant } from "../../types/home-assistant";
import { createFakeMaplibreMap } from "../../../test/fakes/FakeMaplibreMap";
import { CircleRenderService } from "./CircleRenderService";
import { LayerRegistry } from "./LayerRegistry";

function hassWith(states: HomeAssistant["states"]): HomeAssistant {
  return { states, callWS: vi.fn(), language: "en" };
}

function entityWithCircle(id: string, circle: unknown): EntityConfig {
  return EntityConfig.from({ entity: id, fixed_x: 1, fixed_y: 2, circle } as never);
}

describe("CircleRenderService", () => {
  it("adds a source and fill/line layers for an entity with a resolvable radius", () => {
    const map = createFakeMaplibreMap();
    const service = new CircleRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const entity = entityWithCircle("device_tracker.phone", { radius: 25, source: "config" });

    service.update([entity], hassWith({}));

    expect(map.addSource).toHaveBeenCalledWith(
      "circle-device_tracker.phone",
      expect.objectContaining({ type: "geojson" }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "circle-device_tracker.phone-fill", type: "fill" }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "circle-device_tracker.phone-line", type: "line" }),
    );
    expect(service.has("device_tracker.phone")).toBe(true);
  });

  it("skips entities without a circle config", () => {
    const map = createFakeMaplibreMap();
    const service = new CircleRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const entity = EntityConfig.from("device_tracker.phone");

    service.update([entity], hassWith({}));

    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("skips entities whose resolved radius is 0", () => {
    const map = createFakeMaplibreMap();
    const service = new CircleRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const entity = entityWithCircle("device_tracker.phone", { source: "auto" });

    service.update([entity], hassWith({}));

    expect(map.addSource).not.toHaveBeenCalled();
    expect(service.has("device_tracker.phone")).toBe(false);
  });

  it("calls setData on the existing source instead of re-adding it", () => {
    const map = createFakeMaplibreMap();
    const setData = vi.fn();
    map.getSource.mockReturnValue({ setData });
    const service = new CircleRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const entity = entityWithCircle("device_tracker.phone", { radius: 25, source: "config" });

    service.update([entity], hassWith({}));

    expect(setData).toHaveBeenCalledTimes(1);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("removes the source/layers and unregisters reattach + the layer switcher when a circle drops out", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const layerRegistry = new LayerRegistry();
    const service = new CircleRenderService(map as never, reattach, layerRegistry);
    const entity = entityWithCircle("device_tracker.phone", { radius: 25, source: "config" });

    service.update([entity], hassWith({}));
    map.getSource.mockReturnValue({ setData: vi.fn() }); // simulate the source now existing
    service.update([], hassWith({}));

    expect(map.removeLayer).toHaveBeenCalledWith("circle-device_tracker.phone-fill");
    expect(map.removeLayer).toHaveBeenCalledWith("circle-device_tracker.phone-line");
    expect(map.removeSource).toHaveBeenCalledWith("circle-device_tracker.phone");
    expect(reattach.has("circle-device_tracker.phone")).toBe(false);
    expect(layerRegistry.getOverlays().has("circle-device_tracker.phone")).toBe(false);
    expect(service.has("device_tracker.phone")).toBe(false);
  });

  it("registers a StyleReattach factory that replays the most recent geometry after a style reload", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const service = new CircleRenderService(map as never, reattach, new LayerRegistry());
    const entity = entityWithCircle("device_tracker.phone", { radius: 25, source: "config" });

    service.update([entity], hassWith({}));

    const freshMap = createFakeMaplibreMap();
    reattach.replayAll(freshMap as never);

    expect(freshMap.addSource).toHaveBeenCalledWith(
      "circle-device_tracker.phone",
      expect.objectContaining({ type: "geojson" }),
    );
    expect(freshMap.addLayer).toHaveBeenCalledTimes(2);
  });

  it("removeAll() clears every tracked circle", () => {
    const map = createFakeMaplibreMap();
    const service = new CircleRenderService(map as never, new StyleReattach(), new LayerRegistry());
    service.update(
      [
        entityWithCircle("a", { radius: 10, source: "config" }),
        entityWithCircle("b", { radius: 10, source: "config" }),
      ],
      hassWith({}),
    );

    service.removeAll();

    expect(service.has("a")).toBe(false);
    expect(service.has("b")).toBe(false);
  });

  describe("layer switcher integration", () => {
    it("registers an overlay entry for each circle it creates", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new CircleRenderService(map as never, new StyleReattach(), layerRegistry);
      const entity = entityWithCircle("device_tracker.phone", { radius: 25, source: "config" });

      service.update([entity], hassWith({}));

      const overlay = layerRegistry.getOverlays().get("circle-device_tracker.phone");
      expect(overlay?.label).toContain("device_tracker.phone");
      expect(overlay?.group).toBe("circle");
    });

    it("setVisible(map, false) hides both layers via setLayoutProperty", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new CircleRenderService(map as never, new StyleReattach(), layerRegistry);
      const entity = entityWithCircle("device_tracker.phone", { radius: 25, source: "config" });
      service.update([entity], hassWith({}));

      const overlay = layerRegistry.getOverlays().get("circle-device_tracker.phone")!;
      overlay.setVisible(map, false);

      expect(map.setLayoutProperty).toHaveBeenCalledWith(
        "circle-device_tracker.phone-fill",
        "visibility",
        "none",
      );
      expect(map.setLayoutProperty).toHaveBeenCalledWith(
        "circle-device_tracker.phone-line",
        "visibility",
        "none",
      );
    });

    it("a StyleReattach replay after hiding a circle recreates it still hidden", () => {
      const map = createFakeMaplibreMap();
      const reattach = new StyleReattach();
      const layerRegistry = new LayerRegistry();
      const service = new CircleRenderService(map as never, reattach, layerRegistry);
      const entity = entityWithCircle("device_tracker.phone", { radius: 25, source: "config" });
      service.update([entity], hassWith({}));

      const overlay = layerRegistry.getOverlays().get("circle-device_tracker.phone")!;
      overlay.setVisible(map, false);

      const freshMap = createFakeMaplibreMap();
      reattach.replayAll(freshMap as never);

      expect(freshMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ visibility: "none" }) }),
      );
    });
  });
});
