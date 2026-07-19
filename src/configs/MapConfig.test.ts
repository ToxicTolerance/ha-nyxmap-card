import { describe, expect, it } from "vitest";
import { TileLayerConfig } from "./TileLayerConfig";
import { WmsLayerConfig } from "./WmsLayerConfig";
import { DEFAULT_STYLE_DARK, DEFAULT_STYLE_LIGHT, MapConfig } from "./MapConfig";

describe("MapConfig", () => {
  it("throws on missing config", () => {
    // @ts-expect-error deliberately malformed config
    expect(() => new MapConfig(undefined)).toThrow("Missing configuration");
  });

  it("applies defaults for a minimal config", () => {
    const cfg = new MapConfig({});
    expect(cfg.zoom).toBe(12);
    expect(cfg.cardSize).toBe(5);
    expect(cfg.themeMode).toBe("auto");
    expect(cfg.focusFollow).toBe("none");
    expect(cfg.styleLight).toBe(DEFAULT_STYLE_LIGHT);
    expect(cfg.styleDark).toBe(DEFAULT_STYLE_DARK);
    expect(cfg.projection).toBe("globe");
    expect(cfg.layerSwitcher).toBe(false);
    expect(cfg.mapStyles).toEqual([]);
    expect(cfg.entities).toEqual([]);
    expect(cfg.tileLayers).toEqual([]);
    expect(cfg.wms).toEqual([]);
    expect(cfg.maxZoom).toBeUndefined();
    expect(cfg.minZoom).toBeUndefined();
  });

  it("parses max_zoom/min_zoom", () => {
    const cfg = new MapConfig({ max_zoom: 19, min_zoom: 3 });
    expect(cfg.maxZoom).toBe(19);
    expect(cfg.minZoom).toBe(3);
  });

  it("parses tile_layers and wms, each as either a single object or a list", () => {
    const cfg = new MapConfig({
      tile_layers: { url: "https://example.com/{z}/{x}/{y}.png" },
      wms: [
        { url: "https://example.com/wms/a", options: { layers: "a" } },
        { url: "https://example.com/wms/b", options: { layers: "b" } },
      ],
    });
    expect(cfg.tileLayers).toHaveLength(1);
    expect(cfg.tileLayers[0]).toBeInstanceOf(TileLayerConfig);
    expect(cfg.wms).toHaveLength(2);
    expect(cfg.wms.every((w) => w instanceof WmsLayerConfig)).toBe(true);
    expect(cfg.wms.map((w) => w.options.layers)).toEqual(["a", "b"]);
  });

  it("respects an explicit projection override", () => {
    expect(new MapConfig({ projection: "mercator" }).projection).toBe("mercator");
  });

  it("parses map_styles, defaulting styleDark to the light style when unset", () => {
    const cfg = new MapConfig({
      layer_switcher: true,
      map_styles: [
        { name: "Streets", map_style: "https://example.com/streets.json" },
        {
          name: "Satellite",
          map_style: "https://example.com/sat-day.json",
          map_style_dark: "https://example.com/sat-night.json",
        },
      ],
    });
    expect(cfg.layerSwitcher).toBe(true);
    expect(cfg.mapStyles).toEqual([
      {
        name: "Streets",
        styleLight: "https://example.com/streets.json",
        styleDark: "https://example.com/streets.json",
        maxZoom: undefined,
        minZoom: undefined,
      },
      {
        name: "Satellite",
        styleLight: "https://example.com/sat-day.json",
        styleDark: "https://example.com/sat-night.json",
        maxZoom: undefined,
        minZoom: undefined,
      },
    ]);
  });

  it("parses a per-style max_zoom/min_zoom on a map_styles entry", () => {
    const cfg = new MapConfig({
      map_styles: [{ name: "Aerial", map_style: "https://example.com/aerial.json", max_zoom: 19, min_zoom: 3 }],
    });
    expect(cfg.mapStyles[0]?.maxZoom).toBe(19);
    expect(cfg.mapStyles[0]?.minZoom).toBe(3);
  });

  it("parses entities as a mix of strings and objects", () => {
    const cfg = new MapConfig({
      entities: ["device_tracker.a", { entity: "person.b", color: "#123456" }],
    });
    expect(cfg.entities).toHaveLength(2);
    expect(cfg.entities[0]?.id).toBe("device_tracker.a");
    expect(cfg.entities[1]?.color).toBe("#123456");
  });

  describe("mapHeight", () => {
    it("uses explicit height when set", () => {
      expect(new MapConfig({ height: 350 }).mapHeight).toBe(350);
    });

    it("derives from card_size, floored at 200", () => {
      expect(new MapConfig({ card_size: 8 }).mapHeight).toBe(400);
      expect(new MapConfig({ card_size: 1 }).mapHeight).toBe(200);
    });

    it("falls back to the card_size estimate for a percentage/CSS-length height", () => {
      expect(new MapConfig({ height: "100%", card_size: 8 }).mapHeight).toBe(400);
    });
  });

  describe("cssHeight", () => {
    it("renders a numeric height in pixels", () => {
      expect(new MapConfig({ height: 350 }).cssHeight).toBe("350px");
    });

    it("passes a string height through verbatim (e.g. a Panel view filling 100%)", () => {
      expect(new MapConfig({ height: "100%" }).cssHeight).toBe("100%");
      expect(new MapConfig({ height: "50vh" }).cssHeight).toBe("50vh");
    });

    it("falls back to the card_size-derived pixel height when unset", () => {
      expect(new MapConfig({ card_size: 8 }).cssHeight).toBe("400px");
    });
  });
});
