export type CircleSource = "auto" | "config" | "attribute" | "gps_accuracy" | "radius";

export interface CircleConfigRaw {
  source?: CircleSource;
  attribute?: string;
  radius?: number;
  color?: string;
  fill_opacity?: number;
}

/** Per-entity `circle:` config. Mirrors upstream ha-map-card's CircleConfig:
 * `circle: "auto"` enables a circle sized from the entity's gps_accuracy/
 * radius attribute (falling back to `radius` below if neither is set);
 * `circle: {radius, color, fill_opacity, source, attribute}` gives explicit
 * control. `attribute` implies `source: "attribute"` when source is omitted,
 * matching upstream's convenience inference. */
export class CircleConfig {
  readonly source: CircleSource;
  readonly attribute?: string;
  readonly radius: number;
  readonly color?: string;
  readonly fillOpacity: number;

  /** `raw` is the entity's `circle` key verbatim: undefined (disabled),
   * `"auto"`, or a CircleConfigRaw object. `defaultColor` is the owning
   * entity's resolved color, used when the circle doesn't set its own. */
  static from(raw: unknown, defaultColor?: string): CircleConfig | undefined {
    if (!raw) return undefined;
    if (raw === "auto") return new CircleConfig({ source: "auto" }, defaultColor);
    return new CircleConfig(raw, defaultColor);
  }

  constructor(raw: CircleConfigRaw, defaultColor?: string) {
    this.radius = raw.radius ?? 0;
    this.attribute = raw.attribute;
    this.source = raw.source ?? (raw.attribute ? "attribute" : "auto");
    this.color = raw.color ?? defaultColor;
    this.fillOpacity = raw.fill_opacity ?? 0.1;
  }
}
