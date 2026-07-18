import { describe, expect, it, vi } from "vitest";
import { EntityHistory } from "../../models/EntityHistory";
import { StyleReattach } from "../../maplibre/StyleReattach";
import { createFakeMaplibreMap } from "../../../test/fakes/FakeMaplibreMap";
import { HistoryRenderService } from "./HistoryRenderService";

function historiesOf(...entries: EntityHistory[]): Map<string, EntityHistory> {
  return new Map(entries.map((h) => [h.entityId, h]));
}

describe("HistoryRenderService", () => {
  it("adds a source and line layer for an entity with a resolvable path", () => {
    const map = createFakeMaplibreMap();
    const service = new HistoryRenderService(map as never, new StyleReattach());
    const history = new EntityHistory(
      "device_tracker.phone",
      [
        [1, 2],
        [3, 4],
      ],
      "#ff0000",
    );

    service.update(historiesOf(history));

    expect(map.addSource).toHaveBeenCalledWith(
      "history-device_tracker.phone",
      expect.objectContaining({ type: "geojson" }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "history-device_tracker.phone", type: "line" }),
    );
    expect(service.has("device_tracker.phone")).toBe(true);
  });

  it("skips a history with fewer than two points", () => {
    const map = createFakeMaplibreMap();
    const service = new HistoryRenderService(map as never, new StyleReattach());

    service.update(historiesOf(new EntityHistory("device_tracker.phone", [[1, 2]], "#ff0000")));

    expect(map.addSource).not.toHaveBeenCalled();
    expect(service.has("device_tracker.phone")).toBe(false);
  });

  it("calls setData on the existing source instead of re-adding it", () => {
    const map = createFakeMaplibreMap();
    const setData = vi.fn();
    map.getSource.mockReturnValue({ setData });
    const service = new HistoryRenderService(map as never, new StyleReattach());

    service.update(
      historiesOf(
        new EntityHistory(
          "device_tracker.phone",
          [
            [1, 2],
            [3, 4],
          ],
          "#ff0000",
        ),
      ),
    );

    expect(setData).toHaveBeenCalledTimes(1);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("removes the source/layer and unregisters reattach when an entity drops out", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const service = new HistoryRenderService(map as never, reattach);
    const history = new EntityHistory(
      "device_tracker.phone",
      [
        [1, 2],
        [3, 4],
      ],
      "#ff0000",
    );

    service.update(historiesOf(history));
    map.getSource.mockReturnValue({ setData: vi.fn() }); // simulate the source now existing
    service.update(new Map());

    expect(map.removeLayer).toHaveBeenCalledWith("history-device_tracker.phone");
    expect(map.removeSource).toHaveBeenCalledWith("history-device_tracker.phone");
    expect(reattach.has("history-device_tracker.phone")).toBe(false);
    expect(service.has("device_tracker.phone")).toBe(false);
  });

  it("registers a StyleReattach factory that replays the most recent data after a style reload", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const service = new HistoryRenderService(map as never, reattach);
    const history = new EntityHistory(
      "device_tracker.phone",
      [
        [1, 2],
        [3, 4],
      ],
      "#ff0000",
    );

    service.update(historiesOf(history));

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
    const service = new HistoryRenderService(map as never, new StyleReattach());
    service.update(
      historiesOf(
        new EntityHistory(
          "a",
          [
            [1, 2],
            [3, 4],
          ],
          "#fff",
        ),
        new EntityHistory(
          "b",
          [
            [5, 6],
            [7, 8],
          ],
          "#000",
        ),
      ),
    );

    service.removeAll();

    expect(service.has("a")).toBe(false);
    expect(service.has("b")).toBe(false);
  });
});
