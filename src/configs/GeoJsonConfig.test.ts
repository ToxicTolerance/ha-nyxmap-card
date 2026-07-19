import { describe, expect, it } from "vitest";
import { GeoJsonConfig } from "./GeoJsonConfig";

describe("GeoJsonConfig", () => {
  it("returns undefined when the raw geojson key is unset or false", () => {
    expect(GeoJsonConfig.from(undefined)).toBeUndefined();
    expect(GeoJsonConfig.from(false)).toBeUndefined();
  });

  it("parses a bare string as an attribute-name shorthand with defaults", () => {
    const cfg = GeoJsonConfig.from("geo_shape", "#ff0000")!;
    expect(cfg.attribute).toBe("geo_shape");
    expect(cfg.color).toBe("#ff0000");
    expect(cfg.weight).toBe(3);
    expect(cfg.opacity).toBe(1.0);
    expect(cfg.fillOpacity).toBe(0.2);
    expect(cfg.hideMarker).toBe(false);
  });

  it("parses an object config with explicit fields", () => {
    const cfg = GeoJsonConfig.from(
      {
        attribute: "geo_shape",
        color: "#00ff00",
        weight: 5,
        opacity: 0.5,
        fill_opacity: 0.4,
        hide_marker: true,
      },
      "#ff0000",
    )!;
    expect(cfg.attribute).toBe("geo_shape");
    expect(cfg.color).toBe("#00ff00");
    expect(cfg.weight).toBe(5);
    expect(cfg.opacity).toBe(0.5);
    expect(cfg.fillOpacity).toBe(0.4);
    expect(cfg.hideMarker).toBe(true);
  });

  it("defaults attribute to geo_location and falls back to the entity's color", () => {
    const cfg = GeoJsonConfig.from({}, "#123456")!;
    expect(cfg.attribute).toBe("geo_location");
    expect(cfg.color).toBe("#123456");
  });
});
