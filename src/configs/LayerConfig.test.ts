import { describe, expect, it } from "vitest";
import { LayerConfig, parseLayerConfigList } from "./LayerConfig";
import { TileLayerConfig } from "./TileLayerConfig";
import { WmsLayerConfig } from "./WmsLayerConfig";

describe("LayerConfig", () => {
  it("throws when url is missing", () => {
    // @ts-expect-error deliberately malformed config
    expect(() => new LayerConfig({})).toThrow();
  });

  it("parses url and options", () => {
    const cfg = new LayerConfig({ url: "https://example.com/{z}/{x}/{y}.png", options: { minZoom: 2 } });
    expect(cfg.url).toBe("https://example.com/{z}/{x}/{y}.png");
    expect(cfg.options).toEqual({ minZoom: 2 });
  });

  it("folds attribution into options", () => {
    const cfg = new LayerConfig({ url: "https://example.com/tiles", attribution: "© Example" });
    expect(cfg.options).toEqual({ attribution: "© Example" });
  });

  it("lets explicit options.attribution win over the attribution key", () => {
    const cfg = new LayerConfig({
      url: "https://example.com/tiles",
      attribution: "© Example",
      options: { attribution: "© Override" },
    });
    expect(cfg.options.attribution).toBe("© Override");
  });
});

describe("parseLayerConfigList", () => {
  it("returns an empty array when unset", () => {
    expect(parseLayerConfigList(undefined, TileLayerConfig)).toEqual([]);
  });

  it("wraps a single object into a one-element list", () => {
    const result = parseLayerConfigList({ url: "https://example.com/tiles" }, TileLayerConfig);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(TileLayerConfig);
  });

  it("parses a list as-is, constructing the given subclass", () => {
    const result = parseLayerConfigList(
      [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
      WmsLayerConfig,
    );
    expect(result).toHaveLength(2);
    expect(result.every((r) => r instanceof WmsLayerConfig)).toBe(true);
    expect(result.map((r) => r.url)).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  // setConfig() re-parses on every keystroke in HA's YAML editor, so these are
  // states a user types *through*, not just broken saved configs. Throwing
  // propagated out of the MapConfig constructor and HA replaced the card with
  // an error card mid-edit — MapConfig already drops half-typed `entities` and
  // `map_styles` entries for exactly this reason.
  describe("half-typed entries", () => {
    it("drops a null entry, as `tile_layers:\\n  -` produces", () => {
      expect(parseLayerConfigList([null], TileLayerConfig)).toEqual([]);
    });

    it("drops an entry with no url yet", () => {
      const result = parseLayerConfigList([{ options: { name: "radar" } }, { url: "https://ok" }], TileLayerConfig);
      expect(result.map((r) => r.url)).toEqual(["https://ok"]);
    });

    it("drops an entry whose url is not a string", () => {
      expect(parseLayerConfigList([{ url: 42 }], TileLayerConfig)).toEqual([]);
    });

    it("does not throw on a single malformed object", () => {
      expect(() => parseLayerConfigList({ options: {} }, WmsLayerConfig)).not.toThrow();
    });
  });
});
