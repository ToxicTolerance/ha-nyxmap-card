import type { GeoJsonConfig } from "../configs/GeoJsonConfig";
import type { HassEntity } from "../types/home-assistant";

/** Resolves an entity's GeoJSON geometry from its configured attribute,
 * mirroring upstream ha-map-card's GeoJson._getGeoJsonData(): the attribute
 * value may already be an object, or a JSON string to parse; anything else
 * (missing, unparseable, wrong type) resolves to null so the caller can skip
 * rendering rather than crash on malformed entity data. */
export function resolveGeoJsonData(config: GeoJsonConfig, stateObj?: HassEntity): object | null {
  const value = stateObj?.attributes?.[config.attribute];
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as object;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value;
  return null;
}
