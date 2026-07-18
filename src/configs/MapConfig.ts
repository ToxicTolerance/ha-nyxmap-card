import { EntityConfig, type EntityConfigRaw } from "./EntityConfig";

export type ThemeMode = "auto" | "light" | "dark";
export type FocusFollow = "none" | "refocus" | "contains";
export type MapProjection = "mercator" | "globe";

// Free, keyless vector styles so a zero-config card renders on first run
// (see CLAUDE.md §5 "Open risk to flag").
export const DEFAULT_STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
export const DEFAULT_STYLE_DARK =
  "https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export interface MapStyleRaw {
  name: string;
  map_style: string;
  map_style_dark?: string;
}

/** A single named base-style option for the layer switcher (see
 * MapConfig.mapStyles) — a light/dark pair like the card-level map_style/
 * map_style_dark, just given a label and offered as a switcher choice. */
export interface NamedMapStyle {
  name: string;
  styleLight: string;
  styleDark: string;
}

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
  map_styles?: MapStyleRaw[];
  projection?: MapProjection;
  layer_switcher?: boolean;
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
  /** Additional named base-style options for the layer switcher, beyond the
   * primary Light/Dark pair above. Not an upstream key — see CLAUDE.md §5
   * "Layer switcher". */
  readonly mapStyles: NamedMapStyle[];
  /** Not an upstream ha-map-card key (Leaflet has no globe projection) —
   * MapLibre-native, defaults to "globe" per CLAUDE.md's globe decision. */
  readonly projection: MapProjection;
  /** Opt-in layer switcher UI (base-style radio group + overlay checkboxes).
   * Not an upstream key — see CLAUDE.md §5 "Layer switcher". */
  readonly layerSwitcher: boolean;
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
    this.mapStyles = (raw.map_styles ?? []).map((s) => ({
      name: s.name,
      styleLight: s.map_style,
      styleDark: s.map_style_dark ?? s.map_style,
    }));
    this.projection = raw.projection ?? "globe";
    this.layerSwitcher = raw.layer_switcher ?? false;
    this.historyStart = raw.history_start;
    this.historyEnd = raw.history_end;
    this.entities = (raw.entities ?? []).map(EntityConfig.from);
  }

  get mapHeight(): number {
    if (this.height) return this.height;
    return Math.max(200, this.cardSize * 50);
  }
}
