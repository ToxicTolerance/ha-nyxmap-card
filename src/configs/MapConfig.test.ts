import { describe, expect, it } from "vitest";
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
      },
      {
        name: "Satellite",
        styleLight: "https://example.com/sat-day.json",
        styleDark: "https://example.com/sat-night.json",
      },
    ]);
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
  });
});
