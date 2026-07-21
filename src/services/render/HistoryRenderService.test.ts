import { describe, expect, it, vi } from "vitest";
import { EntityHistory } from "../../models/EntityHistory";
import { StyleReattach } from "../../maplibre/StyleReattach";
import { createFakeMaplibreMap } from "../../../test/fakes/FakeMaplibreMap";
import { HistoryRenderService } from "./HistoryRenderService";
import { LayerRegistry } from "./LayerRegistry";

function historiesOf(...entries: EntityHistory[]): Map<string, EntityHistory> {
  return new Map(entries.map((h) => [h.entityId, h]));
}

function twoPointHistory(
  entityId: string,
  color = "#ff0000",
  showLines = true,
  showDots = false,
): EntityHistory {
  return new EntityHistory(
    entityId,
    [
      [1, 2],
      [3, 4],
    ],
    color,
    showLines,
    showDots,
  );
}

describe("HistoryRenderService", () => {
  it("adds a source and line layer for an entity with a resolvable path", () => {
    const map = createFakeMaplibreMap();
    const service = new HistoryRenderService(map as never, new StyleReattach(), new LayerRegistry());

    service.update(historiesOf(twoPointHistory("device_tracker.phone")));

    expect(map.addSource).toHaveBeenCalledWith(
      "history-device_tracker.phone",
      expect.objectContaining({ type: "geojson" }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "history-device_tracker.phone", type: "line" }),
    );
    expect(map.addLayer).not.toHaveBeenCalledWith(expect.objectContaining({ type: "circle" }));
    expect(service.has("device_tracker.phone")).toBe(true);
  });

  it("adds a dots (circle) layer with one Point feature per coordinate when showDots is set", () => {
    const map = createFakeMaplibreMap();
    const service = new HistoryRenderService(map as never, new StyleReattach(), new LayerRegistry());

    service.update(historiesOf(twoPointHistory("device_tracker.phone", "#ff0000", true, true)));

    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "history-device_tracker.phone-dots", type: "circle" }),
    );
    expect(map.addSource).toHaveBeenCalledWith(
      "history-device_tracker.phone",
      expect.objectContaining({
        data: expect.objectContaining({
          features: expect.arrayContaining([
            expect.objectContaining({ geometry: { type: "Point", coordinates: [1, 2] } }),
            expect.objectContaining({ geometry: { type: "Point", coordinates: [3, 4] } }),
          ]),
        }),
      }),
    );
  });

  it("adds only the dots layer when showLines is false", () => {
    const map = createFakeMaplibreMap();
    const service = new HistoryRenderService(map as never, new StyleReattach(), new LayerRegistry());

    service.update(historiesOf(twoPointHistory("device_tracker.phone", "#ff0000", false, true)));

    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "history-device_tracker.phone-dots", type: "circle" }),
    );
  });

  it("skips a history with fewer than two points", () => {
    const map = createFakeMaplibreMap();
    const service = new HistoryRenderService(map as never, new StyleReattach(), new LayerRegistry());

    service.update(historiesOf(new EntityHistory("device_tracker.phone", [[1, 2]], "#ff0000")));

    expect(map.addSource).not.toHaveBeenCalled();
    expect(service.has("device_tracker.phone")).toBe(false);
  });

  it("calls setData on the existing source instead of re-adding it", () => {
    const map = createFakeMaplibreMap();
    const setData = vi.fn();
    map.getSource.mockReturnValue({ setData });
    const service = new HistoryRenderService(map as never, new StyleReattach(), new LayerRegistry());

    service.update(historiesOf(twoPointHistory("device_tracker.phone")));

    expect(setData).toHaveBeenCalledTimes(1);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  // Regression: layers were only ever painted on the addLayer() path, so
  // changing `history_line_color` (or the entity's `color` it falls back to)
  // left an existing trail drawn in the old colour until a theme swap replayed
  // the reattach factory with the fresh value.
  it("pushes a changed line colour onto an existing trail's layers", () => {
    const map = createFakeMaplibreMap();
    const service = new HistoryRenderService(map as never, new StyleReattach(), new LayerRegistry());

    service.update(historiesOf(twoPointHistory("device_tracker.phone", "#ff0000", true, true)));
    map.getSource.mockReturnValue({ setData: vi.fn() }); // the source now exists
    service.update(historiesOf(twoPointHistory("device_tracker.phone", "#0000ff", true, true)));

    expect(map.setPaintProperty).toHaveBeenCalledWith("history-device_tracker.phone", "line-color", "#0000ff");
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      "history-device_tracker.phone-dots",
      "circle-color",
      "#0000ff",
    );
  });

  it("leaves paint alone when only the coordinates changed", () => {
    const map = createFakeMaplibreMap();
    const service = new HistoryRenderService(map as never, new StyleReattach(), new LayerRegistry());

    service.update(historiesOf(twoPointHistory("device_tracker.phone")));
    map.getSource.mockReturnValue({ setData: vi.fn() });
    service.update(historiesOf(twoPointHistory("device_tracker.phone")));

    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });

  it("removes the source/layer and unregisters reattach + the layer switcher when an entity drops out", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const layerRegistry = new LayerRegistry();
    const service = new HistoryRenderService(map as never, reattach, layerRegistry);

    service.update(historiesOf(twoPointHistory("device_tracker.phone")));
    map.getSource.mockReturnValue({ setData: vi.fn() }); // simulate the source now existing
    service.update(new Map());

    expect(map.removeLayer).toHaveBeenCalledWith("history-device_tracker.phone");
    expect(map.removeSource).toHaveBeenCalledWith("history-device_tracker.phone");
    expect(reattach.has("history-device_tracker.phone")).toBe(false);
    expect(layerRegistry.getOverlays().has("history-device_tracker.phone")).toBe(false);
    expect(service.has("device_tracker.phone")).toBe(false);
  });

  it("registers a StyleReattach factory that replays the most recent data after a style reload", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const service = new HistoryRenderService(map as never, reattach, new LayerRegistry());

    service.update(historiesOf(twoPointHistory("device_tracker.phone")));

    // Simulate setStyle() wiping sources/layers: a fresh map with no source.
    const freshMap = createFakeMaplibreMap();
    reattach.replayAll(freshMap as never);

    expect(freshMap.addSource).toHaveBeenCalledWith(
      "history-device_tracker.phone",
      expect.objectContaining({ type: "geojson" }),
    );
    expect(freshMap.addLayer).toHaveBeenCalled();
  });

  it("removeAll() clears every tracked trail", () => {
    const map = createFakeMaplibreMap();
    const service = new HistoryRenderService(map as never, new StyleReattach(), new LayerRegistry());
    service.update(historiesOf(twoPointHistory("a", "#fff"), twoPointHistory("b", "#000")));

    service.removeAll();

    expect(service.has("a")).toBe(false);
    expect(service.has("b")).toBe(false);
  });

  describe("layer switcher integration", () => {
    it("registers an overlay entry for each trail it creates", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new HistoryRenderService(map as never, new StyleReattach(), layerRegistry);

      service.update(historiesOf(twoPointHistory("device_tracker.phone")));

      const overlay = layerRegistry.getOverlays().get("history-device_tracker.phone");
      expect(overlay?.label).toContain("device_tracker.phone");
      expect(overlay?.group).toBe("history");
    });

    it("setVisible(map, false) hides the layer via setLayoutProperty", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new HistoryRenderService(map as never, new StyleReattach(), layerRegistry);
      service.update(historiesOf(twoPointHistory("device_tracker.phone")));

      const overlay = layerRegistry.getOverlays().get("history-device_tracker.phone")!;
      overlay.setVisible(map, false);

      expect(map.setLayoutProperty).toHaveBeenCalledWith(
        "history-device_tracker.phone",
        "visibility",
        "none",
      );
    });

    it("setVisible(map, false) hides both the line and dots layers when both are shown", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new HistoryRenderService(map as never, new StyleReattach(), layerRegistry);
      service.update(historiesOf(twoPointHistory("device_tracker.phone", "#ff0000", true, true)));

      const overlay = layerRegistry.getOverlays().get("history-device_tracker.phone")!;
      overlay.setVisible(map, false);

      expect(map.setLayoutProperty).toHaveBeenCalledWith("history-device_tracker.phone", "visibility", "none");
      expect(map.setLayoutProperty).toHaveBeenCalledWith(
        "history-device_tracker.phone-dots",
        "visibility",
        "none",
      );
    });

    it("a StyleReattach replay after hiding a trail recreates it still hidden", () => {
      const map = createFakeMaplibreMap();
      const reattach = new StyleReattach();
      const layerRegistry = new LayerRegistry();
      const service = new HistoryRenderService(map as never, reattach, layerRegistry);
      service.update(historiesOf(twoPointHistory("device_tracker.phone")));

      const overlay = layerRegistry.getOverlays().get("history-device_tracker.phone")!;
      overlay.setVisible(map, false);

      const freshMap = createFakeMaplibreMap();
      reattach.replayAll(freshMap as never);

      expect(freshMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ visibility: "none" }) }),
      );
    });
  });
});
