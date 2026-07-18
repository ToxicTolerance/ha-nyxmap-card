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
  history_start?: string;
  history_line_color?: string;
  [key: string]: unknown;
}

/** Per-entity config. Mirrors upstream ha-map-card's entity-level YAML surface
 * (see CLAUDE.md §5 for keys that don't carry over 1:1). Only display/marker
 * fields are wired to rendering in Phase 1 — history_start/history_line_color
 * are parsed now so Phase 2 doesn't need to touch this class again. */
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
  readonly historyStart?: string;
  readonly historyLineColor?: string;
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
    this.historyStart = raw.history_start;
    this.historyLineColor = raw.history_line_color ?? raw.color;
  }
}
