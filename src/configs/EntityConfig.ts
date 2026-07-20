import { CircleConfig, type CircleConfigRaw } from "./CircleConfig";
import { GeoJsonConfig, type GeoJsonConfigRaw } from "./GeoJsonConfig";

export type EntityDisplay = "marker" | "icon" | "state";

export interface EntityConfigRaw {
  entity: string;
  display?: EntityDisplay;
  picture?: string;
  icon?: string;
  label?: string;
  color?: string;
  size?: number;
  fixed_x?: number;
  fixed_y?: number;
  z_index_offset?: number;
  focus_on_fit?: boolean;
  history_start?: string;
  history_end?: string;
  history_line_color?: string;
  circle?: "auto" | CircleConfigRaw | false;
  geojson?: string | GeoJsonConfigRaw | false;
  [key: string]: unknown;
}

/** Per-entity config. Mirrors upstream ha-map-card's entity-level YAML surface
 * (see CLAUDE.md §5 for keys that don't carry over 1:1). Only display/marker
 * fields are wired to rendering in Phase 1; history_start/history_end fall
 * back to MapConfig's card-level values when unset (see
 * EntityHistoryManager). */
export class EntityConfig {
  readonly id: string;
  readonly display: EntityDisplay;
  readonly picture?: string;
  readonly icon?: string;
  readonly label?: string;
  readonly color?: string;
  readonly size: number;
  readonly fixedX?: number;
  readonly fixedY?: number;
  readonly zIndexOffset: number;
  readonly focusOnFit: boolean;
  readonly historyStart?: string;
  readonly historyEnd?: string;
  readonly historyLineColor?: string;
  readonly circle?: CircleConfig;
  /** True when the entity's own YAML sets `circle: false`, opting this one
   * entity out of MapConfig.showAccuracyCircles' implicit default-on circle
   * regardless of the card-level setting. */
  readonly circleDisabled: boolean;
  readonly geojson?: GeoJsonConfig;
  readonly raw: EntityConfigRaw;

  static from(e: string | EntityConfigRaw): EntityConfig {
    const raw: EntityConfigRaw = typeof e === "string" ? { entity: e } : e;
    return new EntityConfig(raw);
  }

  constructor(raw: EntityConfigRaw) {
    if (!raw?.entity) throw new Error("Entity config is missing required `entity` key");
    this.raw = raw;
    this.id = raw.entity;
    this.display = raw.display ?? "marker";
    this.picture = raw.picture;
    this.icon = raw.icon;
    this.label = raw.label;
    this.color = raw.color;
    this.size = raw.size ?? 48;
    this.fixedX = raw.fixed_x;
    this.fixedY = raw.fixed_y;
    this.zIndexOffset = raw.z_index_offset ?? 1;
    this.focusOnFit = raw.focus_on_fit ?? true;
    this.historyStart = raw.history_start;
    this.historyEnd = raw.history_end;
    this.historyLineColor = raw.history_line_color ?? raw.color;
    this.circle = CircleConfig.from(raw.circle, this.color);
    this.circleDisabled = raw.circle === false;
    this.geojson = GeoJsonConfig.from(raw.geojson, this.color);
  }
}
