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
    const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png", options: { name: "base" } });

    service.update([tile], [], hassWith({}));

    expect(map.addSource).toHaveBeenCalledWith(
      "tile-layer-base",
      expect.objectContaining({ type: "raster", tiles: ["https://example.com/{z}/{x}/{y}.png"] }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "tile-layer-base", type: "raster" }));
    expect(service.has("tile-layer-base")).toBe(true);
  });

  it("applies minzoom/maxzoom from options onto the raster source", () => {
    const map = createFakeMaplibreMap();
    const service = new TileLayersRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const tile = new LayerConfig({
      url: "https://example.com/{z}/{x}/{y}.png",
      options: { name: "base", minzoom: 5, maxzoom: 20 },
    });

    service.update([tile], [], hassWith({}));

    expect(map.addSource).toHaveBeenCalledWith("tile-layer-base", expect.objectContaining({ minzoom: 5, maxzoom: 20 }));
  });

  it("omits minzoom/maxzoom from the source when not set in options", () => {
    const map = createFakeMaplibreMap();
    const service = new TileLayersRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png", options: { name: "base" } });

    service.update([tile], [], hassWith({}));

    const call = map.addSource.mock.calls.find((c) => c[0] === "tile-layer-base")!;
    expect(call[1]).not.toHaveProperty("minzoom");
    expect(call[1]).not.toHaveProperty("maxzoom");
  });

  it("resolves {{ states() }} templating in a tile layer url", () => {
    const map = createFakeMaplibreMap();
    const service = new TileLayersRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const tile = new LayerConfig({ url: "https://example.com/{{ states('sensor.tile_rev') }}/{z}/{x}/{y}.png", options: { name: "base" } });
    const hass = hassWith({
      "sensor.tile_rev": { entity_id: "sensor.tile_rev", state: "42", attributes: {}, last_changed: "", last_updated: "" },
    });

    service.update([tile], [], hass);

    expect(map.addSource).toHaveBeenCalledWith(
      "tile-layer-base",
      expect.objectContaining({ tiles: ["https://example.com/42/{z}/{x}/{y}.png"] }),
    );
  });

  it("builds a WMS GetMap url template around the {bbox-epsg-3857} token", () => {
    const map = createFakeMaplibreMap();
    const service = new TileLayersRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const wms = new LayerConfig({
      url: "https://example.com/wms",
      options: { name: "radar", layers: "nexrad", format: "image/png", transparent: true },
    });

    service.update([], [wms], hassWith({}));

    const call = map.addSource.mock.calls.find((c) => c[0] === "wms-layer-radar")!;
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
    const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png", options: { name: "base" } });

    service.update([tile], [], hassWith({}));

    expect(setTiles).toHaveBeenCalledTimes(1);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("removes a layer that drops out of config", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const layerRegistry = new LayerRegistry();
    const service = new TileLayersRenderService(map as never, reattach, layerRegistry);
    const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png", options: { name: "base" } });

    service.update([tile], [], hassWith({}));
    map.getSource.mockReturnValue({ setTiles: vi.fn() }); // simulate the source now existing
    service.update([], [], hassWith({}));

    expect(map.removeLayer).toHaveBeenCalledWith("tile-layer-base");
    expect(map.removeSource).toHaveBeenCalledWith("tile-layer-base");
    expect(reattach.has("tile-layer-base")).toBe(false);
    expect(layerRegistry.getOverlays().has("tile-layer-base")).toBe(false);
    expect(service.has("tile-layer-base")).toBe(false);
  });

  it("registers a StyleReattach factory that replays the most recent url after a style reload", () => {
    const map = createFakeMaplibreMap();
    const reattach = new StyleReattach();
    const service = new TileLayersRenderService(map as never, reattach, new LayerRegistry());
    const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png", options: { name: "base" } });

    service.update([tile], [], hassWith({}));

    const freshMap = createFakeMaplibreMap();
    reattach.replayAll(freshMap as never);

    expect(freshMap.addSource).toHaveBeenCalledWith(
      "tile-layer-base",
      expect.objectContaining({ tiles: ["https://example.com/{z}/{x}/{y}.png"] }),
    );
    expect(freshMap.addLayer).toHaveBeenCalled();
  });

  it("removeAll() clears every tracked layer", () => {
    const map = createFakeMaplibreMap();
    const service = new TileLayersRenderService(map as never, new StyleReattach(), new LayerRegistry());
    const a = new LayerConfig({ url: "https://example.com/a", options: { name: "a" } });
    const b = new LayerConfig({ url: "https://example.com/b", options: { name: "b" } });
    service.update([a, b], [], hassWith({}));
    expect(service.has("tile-layer-a")).toBe(true);
    expect(service.has("tile-layer-b")).toBe(true);

    service.removeAll();

    expect(service.has("tile-layer-a")).toBe(false);
    expect(service.has("tile-layer-b")).toBe(false);
  });

  describe("stable per-layer identity (ids no longer follow list position)", () => {
    const A = () => new LayerConfig({ url: "https://a.example.com/{z}/{x}/{y}.png" });
    const B = () => new LayerConfig({ url: "https://b.example.com/{z}/{x}/{y}.png" });

    it("keeps each layer's id across a reorder, so hidden state stays with its own layer", () => {
      const map = createFakeMaplibreMap();
      const reattach = new StyleReattach();
      const layerRegistry = new LayerRegistry();
      const service = new TileLayersRenderService(map as never, reattach, layerRegistry);

      service.update([A(), B()], [], hassWith({}));
      const idsBefore = [...layerRegistry.getOverlays().keys()];
      const urlOf = (id: string) =>
        (map.addSource.mock.calls.find((c) => c[0] === id)![1] as { tiles: string[] }).tiles[0];
      // Hide the *second* layer (B), then swap the two entries in config order.
      const hiddenId = idsBefore[1]!;
      expect(urlOf(hiddenId)).toContain("b.example.com");
      layerRegistry.getOverlays().get(hiddenId)!.setVisible(map, false);

      map.getSource.mockReturnValue({ setTiles: vi.fn() }); // both sources now exist
      service.update([B(), A()], [], hassWith({}));

      // Same two ids, no layer torn down and none re-created under the other's key.
      expect([...layerRegistry.getOverlays().keys()].sort()).toEqual([...idsBefore].sort());
      expect(map.removeSource).not.toHaveBeenCalled();
      // The "hidden" flag still belongs to B: replaying onto a fresh style
      // re-adds B hidden and A visible. Under the old index keying, `hidden`
      // was stored against `tile-layer-1`, which after the swap is A.
      const freshMap = createFakeMaplibreMap();
      reattach.replayAll(freshMap as never);
      const replayed = new Map(
        freshMap.addLayer.mock.calls.map((c) => {
          const layer = c[0] as { id: string; layout: { visibility: string } };
          return [layer.id, layer.layout.visibility];
        }),
      );
      expect(replayed.get(hiddenId)).toBe("none");
      expect(replayed.get(idsBefore[0]!)).toBe("visible");
      const replayedUrlOf = (id: string) =>
        (freshMap.addSource.mock.calls.find((c) => c[0] === id)![1] as { tiles: string[] }).tiles[0];
      expect(replayedUrlOf(hiddenId)).toContain("b.example.com");
    });

    it("labels follow list position while ids do not", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new TileLayersRenderService(map as never, new StyleReattach(), layerRegistry);

      service.update([A(), B()], [], hassWith({}));
      const [idA, idB] = [...layerRegistry.getOverlays().keys()];
      expect(layerRegistry.getOverlays().get(idA!)!.label).toBe("Tile layer 1");
      expect(layerRegistry.getOverlays().get(idB!)!.label).toBe("Tile layer 2");

      map.getSource.mockReturnValue({ setTiles: vi.fn() });
      service.update([B(), A()], [], hassWith({}));

      expect(layerRegistry.getOverlays().get(idA!)!.label).toBe("Tile layer 2");
      expect(layerRegistry.getOverlays().get(idB!)!.label).toBe("Tile layer 1");
    });

    it("uses options.name for both the id and the switcher label when given", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new TileLayersRenderService(map as never, new StyleReattach(), layerRegistry);

      service.update([new LayerConfig({ url: "https://x.example.com/a", options: { name: "Rain Radar" } })], [], hassWith({}));

      expect(service.has("tile-layer-rain-radar")).toBe(true);
      expect(layerRegistry.getOverlays().get("tile-layer-rain-radar")!.label).toBe("Rain Radar");
    });

    it("keeps a layer's id stable when a templated url resolves to a new value", () => {
      const map = createFakeMaplibreMap();
      const service = new TileLayersRenderService(map as never, new StyleReattach(), new LayerRegistry());
      const tile = new LayerConfig({ url: "https://example.com/{{ states('sensor.rev') }}/{z}/{x}/{y}.png" });
      const hassAt = (rev: string) =>
        hassWith({
          "sensor.rev": { entity_id: "sensor.rev", state: rev, attributes: {}, last_changed: "", last_updated: "" },
        });

      service.update([tile], [], hassAt("1"));
      const id = map.addSource.mock.calls[0]![0] as string;
      const setTiles = vi.fn();
      map.getSource.mockReturnValue({ setTiles });
      service.update([tile], [], hassAt("2"));

      expect(setTiles).toHaveBeenCalledWith(["https://example.com/2/{z}/{x}/{y}.png"]);
      expect(service.has(id)).toBe(true);
      expect(map.addSource).toHaveBeenCalledTimes(1);
    });

    it("disambiguates two layers that share a url", () => {
      const map = createFakeMaplibreMap();
      const service = new TileLayersRenderService(map as never, new StyleReattach(), new LayerRegistry());

      service.update([A(), A()], [], hassWith({}));

      const ids = map.addSource.mock.calls.map((c) => c[0] as string);
      expect(new Set(ids).size).toBe(2);
      expect(ids[1]).toBe(`${ids[0]}-1`);
    });
  });

  describe("layer switcher integration", () => {
    it("registers an overlay entry for each layer it creates", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new TileLayersRenderService(map as never, new StyleReattach(), layerRegistry);
      const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png", options: { name: "base" } });

      service.update([tile], [], hassWith({}));

      const overlay = layerRegistry.getOverlays().get("tile-layer-base");
      expect(overlay?.group).toBe("raster");
    });

    it("setVisible(map, false) hides the layer via setLayoutProperty", () => {
      const map = createFakeMaplibreMap();
      const layerRegistry = new LayerRegistry();
      const service = new TileLayersRenderService(map as never, new StyleReattach(), layerRegistry);
      const tile = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png", options: { name: "base" } });
      service.update([tile], [], hassWith({}));

      const overlay = layerRegistry.getOverlays().get("tile-layer-base")!;
      overlay.setVisible(map, false);

      expect(map.setLayoutProperty).toHaveBeenCalledWith("tile-layer-base", "visibility", "none");
    });
  });
});
