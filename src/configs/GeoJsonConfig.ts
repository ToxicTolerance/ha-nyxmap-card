export interface GeoJsonConfigRaw {
  attribute?: string;
  color?: string;
  weight?: number;
  opacity?: number;
  fill_opacity?: number;
  hide_marker?: boolean;
}

/** Per-entity `geojson:` config. Mirrors upstream ha-map-card's
 * GeoJsonConfig: `geojson: "attribute_name"` shorthand, or
 * `geojson: {attribute, color, weight, opacity, fill_opacity, hide_marker}`
 * for explicit control. `false`/unset disables it. */
export class GeoJsonConfig {
  readonly attribute: string;
  readonly color?: string;
  readonly weight: number;
  readonly opacity: number;
  readonly fillOpacity: number;
  readonly hideMarker: boolean;

  /** `raw` is the entity's `geojson` key verbatim: falsy (disabled), a
   * string (attribute name shorthand), or a GeoJsonConfigRaw object.
   * `defaultColor` is the owning entity's resolved color, used when the
   * geojson config doesn't set its own. */
  static from(raw: unknown, defaultColor?: string): GeoJsonConfig | undefined {
    if (!raw) return undefined;
    if (typeof raw === "string") return new GeoJsonConfig({ attribute: raw }, defaultColor);
    return new GeoJsonConfig(raw as GeoJsonConfigRaw, defaultColor);
  }

  constructor(raw: GeoJsonConfigRaw, defaultColor?: string) {
    this.attribute = raw.attribute ?? "geo_location";
    this.color = raw.color ?? defaultColor;
    this.weight = raw.weight ?? 3;
    this.opacity = raw.opacity ?? 1.0;
    this.fillOpacity = raw.fill_opacity ?? 0.2;
    this.hideMarker = raw.hide_marker ?? false;
  }
}
