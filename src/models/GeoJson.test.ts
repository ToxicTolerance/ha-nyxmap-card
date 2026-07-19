import { describe, expect, it } from "vitest";
import { GeoJsonConfig } from "../configs/GeoJsonConfig";
import type { HassEntity } from "../types/home-assistant";
import { resolveGeoJsonData } from "./GeoJson";

function stateWith(attributes: Record<string, unknown>): HassEntity {
  return {
    entity_id: "geo_location.demo",
    state: "on",
    attributes,
    last_changed: "",
    last_updated: "",
  };
}

describe("resolveGeoJsonData", () => {
  const cfg = new GeoJsonConfig({ attribute: "geo_shape" });

  it("returns the object directly when the attribute already holds one", () => {
    const shape = { type: "Point", coordinates: [1, 2] };
    expect(resolveGeoJsonData(cfg, stateWith({ geo_shape: shape }))).toBe(shape);
  });

  it("parses a JSON string attribute", () => {
    const shape = { type: "Point", coordinates: [1, 2] };
    const result = resolveGeoJsonData(cfg, stateWith({ geo_shape: JSON.stringify(shape) }));
    expect(result).toEqual(shape);
  });

  it("returns null for an unparseable JSON string", () => {
    expect(resolveGeoJsonData(cfg, stateWith({ geo_shape: "{not json" }))).toBeNull();
  });

  it("returns null when the attribute is missing", () => {
    expect(resolveGeoJsonData(cfg, stateWith({}))).toBeNull();
  });

  it("returns null when there is no state at all", () => {
    expect(resolveGeoJsonData(cfg, undefined)).toBeNull();
  });

  it("returns null for a non-string, non-object attribute value", () => {
    expect(resolveGeoJsonData(cfg, stateWith({ geo_shape: 42 }))).toBeNull();
  });
});
