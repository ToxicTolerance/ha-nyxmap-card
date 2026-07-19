import { describe, expect, it, vi } from "vitest";
import { LayerConfig } from "../../configs/LayerConfig";
import { StyleReattach } from "../../maplibre/StyleReattach";
import type { HomeAssistant } from "../../types/home-assistant";
import { createFakeMaplibreMap } from "../../../test/fakes/FakeMaplibreMap";
import { LayerRegistry } from "./LayerRegistry";
import { TileLayersRenderService } from "./TileLayersRenderService";

function hassWith(states: HomeAssistant["states"]): HomeAssistant {
  return { states, callWS: vi.fn(), language: "en" };
}

describe("TileLayersRenderService", () => {
  it("adds a raster source and layer for a tile layer", () => {
    const map = createFakeMaplibreMap();
    const service = new TileLayersRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png" });

    service.update([tile], [], hassWith({}));

    expect(map.addSource).toHaveBeenCalledWith(
      "tile-layer-0",
      expect.objectContaining({ type: "raster", tiles: ["https://example.com/{z}/{x}/{y}.png"] }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "tile-layer-0", type: "raster" }));
    expect(service.has("tile-layer-0")).toBe(true);
  });

  it("resolves {{ states() }} templating in a tile layer url", () => {
    const map = createFakeMaplibreMap();
    const service = new TileLayersRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const tile = new LayerConfig({ url: "https://example.com/{{ states('sensor.tile_rev') }}/{z}/{x}/{y}.png" });
    const hass = hassWith({
      "sensor.tile_rev": { entity_id: "sensor.tile_rev", state: "42", attributes: {}, last_changed: "", last_updated: "" },
    });

    service.update([tile], [], hass);

    expect(map.addSource).toHaveBeenCalledWith(
      "tile-layer-0",
      expect.objectContaining({ tiles: ["https://example.com/42/{z}/{x}/{y}.png"] }),
    );
  });

  it("builds a WMS GetMap url template around the {bbox-epsg-3857} token", () => {
    const map = createFakeMaplibreMap();
    const service = new TileLayersRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const wms = new LayerConfig({
      url: "https://example.com/wms",
      options: { layers: "nexrad", format: "image/png", transparent: true },
    });

    service.update([], [wms], hassWith({}));

    const call = map.addSource.mock.calls.find((c) => c[0] === "wms-layer-0")!;
    const url = (call[1] as { tiles: string[] }).tiles[0]!;
    expect(url).toContain("https://example.com/wms?");
    expect(url).toContain("SERVICE=WMS");
    expect(url).toContain("REQUEST=GetMap");
    expect(url).toContain("LAYERS=nexrad");
    expect(url).toContain("FORMAT=image%2Fpng");
    expect(url).toContain("BBOX={bbox-epsg-3857}");
  });

  it("calls setTiles on the existing source instead of re-adding it", () => {
    const map = createFakeMaplibreMap();
    const setTiles = vi.fn();
    map.getSource.mockReturnValue({ setTiles });
    const service = new TileLayersRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png" });

    service.update([tile], [], hassWith({}));

    expect(setTiles).toHaveBeenCalledTimes(1);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("removes a layer that drops out of config", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const layerRegistry = new LayerRegistry();
    const service = new TileLayersRenderService(map as never, reattach, layerRegistry);
    const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png" });

    service.update([tile], [], hassWith({}));
    map.getSource.mockReturnValue({ setTiles: vi.fn() }); // simulate the source now existing
    service.update([], [], hassWith({}));

    expect(map.removeLayer).toHaveBeenCalledWith("tile-layer-0");
    expect(map.removeSource).toHaveBeenCalledWith("tile-layer-0");
    expect(reattach.has("tile-layer-0")).toBe(false);
    expect(layerRegistry.getOverlays().has("tile-layer-0")).toBe(false);
    expect(service.has("tile-layer-0")).toBe(false);
  });

  it("registers a StyleReattach factory that replays the most recent url after a style reload", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const service = new TileLayersRenderService(map as never, reattach, new LayerRegistry());
    const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png" });

    service.update([tile], [], hassWith({}));

    const freshMap = createFakeMaplibreMap();
    reattach.replayAll(freshMap as never);

    expect(freshMap.addSource).toHaveBeenCalledWith(
      "tile-layer-0",
      expect.objectContaining({ tiles: ["https://example.com/{z}/{x}/{y}.png"] }),
    );
    expect(freshMap.addLayer).toHaveBeenCalled();
  });

  it("removeAll() clears every tracked layer", () => {
    const map = createFakeMaplibreMap();
    const service = new TileLayersRenderService(map as never, new StyleReattach(), new LayerRegistry());
    service.update(
      [new LayerConfig({ url: "https://example.com/a" }), new LayerConfig({ url: "https://example.com/b" })],
      [],
      hassWith({}),
    );

    service.removeAll();

    expect(service.has("tile-layer-0")).toBe(false);
    expect(service.has("tile-layer-1")).toBe(false);
  });

  describe("layer switcher integration", () => {
    it("registers an overlay entry for each layer it creates", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new TileLayersRenderService(map as never, new StyleReattach(), layerRegistry);
      const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png" });

      service.update([tile], [], hassWith({}));

      const overlay = layerRegistry.getOverlays().get("tile-layer-0");
      expect(overlay?.group).toBe("raster");
    });

    it("setVisible(map, false) hides the layer via setLayoutProperty", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new TileLayersRenderService(map as never, new StyleReattach(), layerRegistry);
      const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png" });
      service.update([tile], [], hassWith({}));

      const overlay = layerRegistry.getOverlays().get("tile-layer-0")!;
      overlay.setVisible(map, false);

      expect(map.setLayoutProperty).toHaveBeenCalledWith("tile-layer-0", "visibility", "none");
    });
  });
});
