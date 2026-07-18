import { EntityConfig, type EntityConfigRaw } from "./EntityConfig";

export type ThemeMode = "auto" | "light" | "dark";
export type FocusFollow = "none" | "refocus" | "contains";

// Free, keyless vector styles so a zero-config card renders on first run
// (see CLAUDE.md §5 "Open risk to flag").
export const DEFAULT_STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
export const DEFAULT_STYLE_DARK =
  "https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export interface MapConfigRaw {
  x?: number;
  y?: number;
  zoom?: number;
  title?: string;
  card_size?: number;
  height?: number;
  theme_mode?: ThemeMode;
  focus_entity?: string;
  focus_follow?: FocusFollow;
  map_style?: string;
  map_style_dark?: string;
  history_start?: string;
  history_end?: string;
  entities?: Array<string | EntityConfigRaw>;
  [key: string]: unknown;
}

export class MapConfig {
  readonly raw: MapConfigRaw;
  readonly x?: number;
  readonly y?: number;
  readonly zoom: number;
  readonly title?: string;
  readonly cardSize: number;
  readonly height?: number;
  readonly themeMode: ThemeMode;
  readonly focusEntity?: string;
  readonly focusFollow: FocusFollow;
  readonly styleLight: string;
  readonly styleDark: string;
  /** Card-level history_start/history_end fallback — inherited by entities
   * that don't define their own (see EntityConfig.historyStart). */
  readonly historyStart?: string;
  readonly historyEnd?: string;
  readonly entities: EntityConfig[];

  constructor(raw: MapConfigRaw) {
    if (!raw) throw new Error("Missing configuration");
    this.raw = raw;
    this.x = raw.x;
    this.y = raw.y;
    this.zoom = raw.zoom ?? 12;
    this.title = raw.title;
    this.cardSize = raw.card_size ?? 5;
    this.height = raw.height;
    this.themeMode = raw.theme_mode ?? "auto";
    this.focusEntity = raw.focus_entity;
    this.focusFollow = raw.focus_follow ?? "none";
    this.styleLight = raw.map_style ?? DEFAULT_STYLE_LIGHT;
    this.styleDark = raw.map_style_dark ?? DEFAULT_STYLE_DARK;
    this.historyStart = raw.history_start;
    this.historyEnd = raw.history_end;
    this.entities = (raw.entities ?? []).map(EntityConfig.from);
  }

  get mapHeight(): number {
    if (this.height) return this.height;
    return Math.max(200, this.cardSize * 50);
  }
}
