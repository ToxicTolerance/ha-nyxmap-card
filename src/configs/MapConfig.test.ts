import { describe, expect, it } from "vitest";
import { TileLayerConfig } from "./TileLayerConfig";
import { WmsLayerConfig } from "./WmsLayerConfig";
import { DEFAULT_STYLE_DARK, DEFAULT_STYLE_LIGHT, MapConfig, type MapStyleRaw } from "./MapConfig";

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
    expect(cfg.historyShowLines).toBe(true);
    expect(cfg.historyShowDots).toBe(false);
    expect(cfg.clusterMarkers).toBe(true);
    expect(cfg.clusterMaxZoom).toBe(14);
    expect(cfg.showAccuracyCircles).toBe(true);
    expect(cfg.plugins).toBe(true);
  });

  it("parses plugins: false to disable the JS plugin hook", () => {
    const cfg = new MapConfig({ plugins: false });
    expect(cfg.plugins).toBe(false);
  });

  it("parses max_zoom/min_zoom", () => {
    const cfg = new MapConfig({ max_zoom: 19, min_zoom: 3 });
    expect(cfg.maxZoom).toBe(19);
    expect(cfg.minZoom).toBe(3);
  });

  it("parses history_show_lines/history_show_dots", () => {
    const cfg = new MapConfig({ history_show_lines: false, history_show_dots: true });
    expect(cfg.historyShowLines).toBe(false);
    expect(cfg.historyShowDots).toBe(true);
  });

  it("parses cluster_markers: false to disable the default-on clustering", () => {
    const cfg = new MapConfig({ cluster_markers: false });
    expect(cfg.clusterMarkers).toBe(false);
  });

  it("parses cluster_max_zoom", () => {
    const cfg = new MapConfig({ cluster_max_zoom: 16 });
    expect(cfg.clusterMaxZoom).toBe(16);
  });

  it("parses show_accuracy_circles: false", () => {
    const cfg = new MapConfig({ show_accuracy_circles: false });
    expect(cfg.showAccuracyCircles).toBe(false);
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

  describe("map_styles validation", () => {
    // A map_styles entry with no usable map_style used to yield
    // `styleLight: undefined`, which reaches map.setStyle(undefined) — MapLibre
    // reads that as "remove the style" and blanks the map. See code-review §13.
    it("drops an entry with no map_style", () => {
      const cfg = new MapConfig({
        map_styles: [
          { name: "Half-typed" } as unknown as MapStyleRaw,
          { name: "Streets", map_style: "https://example.com/streets.json" },
        ],
      });
      expect(cfg.mapStyles.map((s) => s.name)).toEqual(["Streets"]);
      expect(cfg.mapStyles.every((s) => !!s.styleLight)).toBe(true);
    });

    it("drops the visual editor's freshly-added blank row", () => {
      // "+ Add style" emits map_styles: [{ name: "" }] before anything is typed.
      const cfg = new MapConfig({ map_styles: [{ name: "" } as unknown as MapStyleRaw] });
      expect(cfg.mapStyles).toEqual([]);
    });

    it("drops an entry with no name (it would have no switcher label or id)", () => {
      const cfg = new MapConfig({
        map_styles: [{ name: "   ", map_style: "https://example.com/a.json" }],
      });
      expect(cfg.mapStyles).toEqual([]);
    });

    it("drops an entry whose map_style is blank/whitespace", () => {
      const cfg = new MapConfig({ map_styles: [{ name: "Streets", map_style: "  " }] });
      expect(cfg.mapStyles).toEqual([]);
    });

    it("de-duplicates entries by name, keeping the first", () => {
      // Both would map to the same `custom:Streets` registry id, so the second
      // silently replaced the first in the layer switcher.
      const cfg = new MapConfig({
        map_styles: [
          { name: "Streets", map_style: "https://example.com/first.json" },
          { name: "Streets", map_style: "https://example.com/second.json" },
        ],
      });
      expect(cfg.mapStyles).toHaveLength(1);
      expect(cfg.mapStyles[0]?.styleLight).toBe("https://example.com/first.json");
    });

    it("trims surrounding whitespace off name and style urls", () => {
      const cfg = new MapConfig({
        map_styles: [{ name: " Streets ", map_style: " https://example.com/streets.json " }],
      });
      expect(cfg.mapStyles[0]?.name).toBe("Streets");
      expect(cfg.mapStyles[0]?.styleLight).toBe("https://example.com/streets.json");
      expect(cfg.mapStyles[0]?.styleDark).toBe("https://example.com/streets.json");
    });

    it("ignores a null hole in the list instead of throwing", () => {
      const cfg = new MapConfig({
        map_styles: [null as unknown as MapStyleRaw, { name: "Streets", map_style: "https://example.com/s.json" }],
      });
      expect(cfg.mapStyles.map((s) => s.name)).toEqual(["Streets"]);
    });
  });

  it("parses entities as a mix of strings and objects", () => {
    const cfg = new MapConfig({
      entities: ["device_tracker.a", { entity: "person.b", color: "#123456" }],
    });
    expect(cfg.entities).toHaveLength(2);
    expect(cfg.entities[0]?.id).toBe("device_tracker.a");
    expect(cfg.entities[1]?.color).toBe("#123456");
  });

  describe("entities parsing tolerance", () => {
    // The visual editor emits `{ entity: "" }` the instant "+ Add entity" is
    // clicked (and again when an entity picker is cleared). EntityConfig's
    // constructor throws on that, which used to escape setConfig and replace
    // the whole card with an HA error card.
    it("skips a half-filled entity row instead of throwing", () => {
      const cfg = new MapConfig({
        entities: [{ entity: "" }, { entity: "person.b" }],
      });
      expect(cfg.entities.map((e) => e.id)).toEqual(["person.b"]);
    });

    it("skips a whitespace-only or non-string entity id", () => {
      const cfg = new MapConfig({
        entities: [
          { entity: "   " },
          { entity: undefined as unknown as string },
          { entity: 42 as unknown as string },
          "",
          "person.b",
        ],
      });
      expect(cfg.entities.map((e) => e.id)).toEqual(["person.b"]);
    });

    it("ignores a null hole in the entities list instead of throwing", () => {
      const cfg = new MapConfig({
        entities: [null as unknown as string, "person.b"],
      });
      expect(cfg.entities.map((e) => e.id)).toEqual(["person.b"]);
    });

    it("keeps a usable entity id verbatim rather than trimming it", () => {
      // Only the emptiness check trims; the id itself is whatever the config
      // said, so it still matches hass.states.
      const cfg = new MapConfig({ entities: [{ entity: "person.b", label: "B" }] });
      expect(cfg.entities[0]?.id).toBe("person.b");
      expect(cfg.entities[0]?.label).toBe("B");
    });
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
