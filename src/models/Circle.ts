import type { CircleConfig } from "../configs/CircleConfig";
import type { HassEntity } from "../types/home-assistant";

/** Resolves a circle's radius (meters) from its config and the entity's
 * current state, mirroring upstream ha-map-card's Circle.radius getter: an
 * explicit source wins outright; "auto" prefers gps_accuracy, then a radius
 * attribute, then falls back to the config's own radius (0 if none apply). */
export function resolveCircleRadius(config: CircleConfig, stateObj?: HassEntity): number {
  const attributes = stateObj?.attributes ?? {};
  const numberAttr = (key: string): number | undefined => {
    const v = attributes[key];
    return typeof v === "number" ? v : undefined;
  };

  switch (config.source) {
    case "config":
      return config.radius;
    case "attribute":
      return (config.attribute ? numberAttr(config.attribute) : undefined) ?? 0;
    case "gps_accuracy":
      return numberAttr("gps_accuracy") ?? 0;
    case "radius":
      return numberAttr("radius") ?? 0;
    case "auto":
    default:
      return numberAttr("gps_accuracy") ?? numberAttr("radius") ?? (config.radius > 0 ? config.radius : 0);
  }
}
