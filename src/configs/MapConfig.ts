import { EntityConfig, type EntityConfigRaw } from "./EntityConfig";
import { type LayerConfigRaw, parseLayerConfigList } from "./LayerConfig";
import { TileLayerConfig } from "./TileLayerConfig";
import { WmsLayerConfig } from "./WmsLayerConfig";

export type ThemeMode = "auto" | "light" | "dark";
export type FocusFollow = "none" | "refocus" | "contains";
export type MapProjection = "mercator" | "globe";

// Free, keyless vector styles so a zero-config card renders on first run
// (see CLAUDE.md "Config surface", map_style bullet — the open risk to flag).
export const DEFAULT_STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
export const DEFAULT_STYLE_DARK =
  "https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export interface MapStyleRaw {
  name: string;
  map_style: string;
  map_style_dark?: string;
  /** Per-style zoom cap, independent of the card-level max_zoom/min_zoom —
   * different base styles can have genuinely different real coverage (e.g. a
   * regional aerial-imagery style topping out well below a general-purpose
   * vector style), so a single global cap can't fit all of them at once. */
  max_zoom?: number;
  min_zoom?: number;
}

/** A single named base-style option for the layer switcher (see
 * MapConfig.mapStyles) — a light/dark pair like the card-level map_style/
 * map_style_dark, just given a label and offered as a switcher choice. */
export interface NamedMapStyle {
  name: string;
  styleLight: string;
  styleDark: string;
  maxZoom?: number;
  minZoom?: number;
}

/**
 * Both fields of a map_styles entry are load-bearing and neither is validated
 * by anything downstream, so an unusable entry is dropped here rather than
 * propagated:
 *
 *  - No usable `map_style` → `styleLight` would be `undefined`, which reaches
 *    `map.setStyle(undefined)` when the entry is picked in the layer switcher.
 *    MapLibre reads that as "remove the style" and the map goes blank with no
 *    error. Trivially reachable from the visual editor, which emits
 *    `map_styles: [{ name: "" }]` the instant "+ Add style" is clicked.
 *  - No usable `name` → the entry has no switcher label and (since ids are
 *    built as `custom:${name}`) no distinguishable id.
 *  - Duplicate `name` → both entries map to the same `custom:${name}` id, so
 *    the second silently replaces the first in the registry. First wins here,
 *    so this list matches what the switcher actually offers.
 *
 * Dropped entries are silent rather than console-warned on purpose: MapConfig
 * is re-parsed on every setConfig, i.e. on every keystroke in the visual
 * editor, where a half-typed entry is the normal intermediate state. The
 * feedback is the entry not appearing in the switcher until it's complete.
 */
function parseMapStyles(raw: MapStyleRaw[] | undefined): NamedMapStyle[] {
  const out: NamedMapStyle[] = [];
  const seen = new Set<string>();
  for (const s of raw ?? []) {
    if (!s) continue;
    const name = typeof s.name === "string" ? s.name.trim() : "";
    const styleLight = typeof s.map_style === "string" ? s.map_style.trim() : "";
    if (!name || !styleLight || seen.has(name)) continue;
    seen.add(name);
    const styleDark = typeof s.map_style_dark === "string" ? s.map_style_dark.trim() : "";
    out.push({
      name,
      styleLight,
      styleDark: styleDark || styleLight,
      maxZoom: s.max_zoom,
      minZoom: s.min_zoom,
    });
  }
  return out;
}

/**
 * `entity` is the one load-bearing key of an entity entry and EntityConfig's
 * constructor throws without it, so an unusable entry is dropped here rather
 * than propagated:
 *
 *  - No usable `entity` → `EntityConfig.from` throws, and because MapConfig is
 *    built from setConfig the throw escapes the card entirely, replacing the
 *    live preview (and, once saved, the dashboard card) with an HA error card
 *    recoverable only through YAML mode. Trivially reachable from the visual
 *    editor, which emits `entities: [..., { entity: "" }]` the instant
 *    "+ Add entity" is clicked, and again whenever an entity picker is
 *    cleared.
 *
 * Dropped entries are silent rather than console-warned for the same reason as
 * parseMapStyles above: MapConfig is re-parsed on every setConfig, i.e. on
 * every keystroke in the visual editor, where a half-filled row is the normal
 * intermediate state. The feedback is the entity not appearing on the map
 * until it's complete.
 *
 * Tolerance belongs here, at the parse boundary, and not in EntityConfig —
 * throwing stays correct for a programmatic caller that hand-builds one.
 */
function parseEntities(raw: Array<string | EntityConfigRaw> | undefined): EntityConfig[] {
  const out: EntityConfig[] = [];
  for (const e of raw ?? []) {
    if (!e) continue;
    const id = typeof e === "string" ? e : typeof e.entity === "string" ? e.entity : "";
    if (!id.trim()) continue;
    out.push(EntityConfig.from(e));
  }
  return out;
}

export interface MapConfigRaw {
  x?: number;
  y?: number;
  zoom?: number;
  /** Caps how far the camera can zoom in/out. Unset uses MapLibre's own
   * defaults (0/22) — set max_zoom if a raster tile_layers/wms overlay (or
   * the base style itself) doesn't have imagery past a certain zoom, so
   * zooming in stops at the last real tiles instead of going blank. */
  max_zoom?: number;
  min_zoom?: number;
  title?: string;
  card_size?: number;
  /** Pixels (number) or any CSS length (string, e.g. "100%"/"50vh") — the
   * latter is mainly for a Home Assistant Panel view, where the card fills
   * the whole viewport and a fixed pixel height can never match it exactly,
   * causing page scroll. */
  height?: number | string;
  theme_mode?: ThemeMode;
  focus_entity?: string;
  focus_follow?: FocusFollow;
  map_style?: string;
  map_style_dark?: string;
  map_styles?: MapStyleRaw[];
  projection?: MapProjection;
  layer_switcher?: boolean;
  /** Kill-switch for the JS plugin hook (window.nyxmapPlugins /
   * nyxmap-map-ready). Defaults on; set false to withhold the map instance
   * from plugins entirely. */
  plugins?: boolean;
  history_start?: string;
  history_end?: string;
  /** Whether to draw the connecting trail line / a dot per sampled position.
   * Card-level only, applied to every entity's history — matches upstream.
   * Defaults mirror upstream: lines on, dots off. */
  history_show_lines?: boolean;
  history_show_dots?: boolean;
  /** Marker clustering: entities whose on-screen marker circles overlap
   * collapse into a numbered bubble that animates on merge/split. Defaults
   * on, matching Home Assistant's own built-in map. */
  cluster_markers?: boolean;
  /** Zoom level at and above which clustering stops entirely, regardless of
   * how close entities render. */
  cluster_max_zoom?: number;
  /** Whether entities with a gps_accuracy/radius attribute get an automatic
   * accuracy circle (see EntityConfig.circle), matching HA's own built-in
   * map. Defaults on; set false to require an explicit per-entity `circle:`
   * instead. An entity's own `circle: false` always opts that one entity out
   * regardless of this card-level setting. */
  show_accuracy_circles?: boolean;
  /** Raster overlay(s) layered on top of the vector base style. A single
   * object or a list; `url` supports `{{ states('entity_id') }}` templating
   * and, for tile layers, the usual `{z}/{x}/{y}` XYZ tokens. */
  tile_layers?: LayerConfigRaw | LayerConfigRaw[];
  /** WMS overlay(s) — `url` is the bare service endpoint (no query string);
   * `options` supplies WMS GetMap params (layers/format/transparent/etc). */
  wms?: LayerConfigRaw | LayerConfigRaw[];
  entities?: Array<string | EntityConfigRaw>;
  [key: string]: unknown;
}

export class MapConfig {
  readonly raw: MapConfigRaw;
  readonly x?: number;
  readonly y?: number;
  readonly zoom: number;
  readonly maxZoom?: number;
  readonly minZoom?: number;
  readonly title?: string;
  readonly cardSize: number;
  readonly height?: number | string;
  readonly themeMode: ThemeMode;
  readonly focusEntity?: string;
  readonly focusFollow: FocusFollow;
  readonly styleLight: string;
  readonly styleDark: string;
  /** Additional named base-style options for the layer switcher, beyond the
   * primary Light/Dark pair above. Not an upstream key — see CLAUDE.md
   * "Config surface". */
  readonly mapStyles: NamedMapStyle[];
  /** Not an upstream ha-map-card key (Leaflet has no globe projection) —
   * MapLibre-native, defaults to "globe" — see CLAUDE.md "Config surface",
   * projection bullet. */
  readonly projection: MapProjection;
  /** Opt-in layer switcher UI (base-style radio group + overlay checkboxes).
   * Not an upstream key — see CLAUDE.md "Config surface". */
  readonly layerSwitcher: boolean;
  /** Whether the JS plugin hook is active (see MapConfigRaw.plugins). */
  readonly plugins: boolean;
  /** Card-level history_start/history_end fallback — inherited by entities
   * that don't define their own (see EntityConfig.historyStart). */
  readonly historyStart?: string;
  readonly historyEnd?: string;
  readonly historyShowLines: boolean;
  readonly historyShowDots: boolean;
  readonly clusterMarkers: boolean;
  readonly clusterMaxZoom: number;
  readonly showAccuracyCircles: boolean;
  readonly tileLayers: TileLayerConfig[];
  readonly wms: WmsLayerConfig[];
  readonly entities: EntityConfig[];

  constructor(raw: MapConfigRaw) {
    if (!raw) throw new Error("Missing configuration");
    this.raw = raw;
    this.x = raw.x;
    this.y = raw.y;
    this.zoom = raw.zoom ?? 12;
    this.maxZoom = raw.max_zoom;
    this.minZoom = raw.min_zoom;
    this.title = raw.title;
    this.cardSize = raw.card_size ?? 5;
    this.height = raw.height;
    this.themeMode = raw.theme_mode ?? "auto";
    this.focusEntity = raw.focus_entity;
    this.focusFollow = raw.focus_follow ?? "none";
    this.styleLight = raw.map_style ?? DEFAULT_STYLE_LIGHT;
    this.styleDark = raw.map_style_dark ?? DEFAULT_STYLE_DARK;
    this.mapStyles = parseMapStyles(raw.map_styles);
    this.projection = raw.projection ?? "globe";
    this.layerSwitcher = raw.layer_switcher ?? false;
    this.plugins = raw.plugins ?? true;
    this.historyStart = raw.history_start;
    this.historyEnd = raw.history_end;
    this.historyShowLines = raw.history_show_lines ?? true;
    this.historyShowDots = raw.history_show_dots ?? false;
    this.entities = parseEntities(raw.entities);
    this.clusterMarkers = raw.cluster_markers ?? true;
    this.clusterMaxZoom = raw.cluster_max_zoom ?? 14;
    this.showAccuracyCircles = raw.show_accuracy_circles ?? true;
    this.tileLayers = parseLayerConfigList(raw.tile_layers, TileLayerConfig);
    this.wms = parseLayerConfigList(raw.wms, WmsLayerConfig);
  }

  /** Numeric pixel estimate of the map's height, used for HA's masonry
   * layout math (getCardSize()) — a percentage/CSS-length `height` can't be
   * resolved to real pixels here, so it falls back to the card_size-based
   * estimate (percentage heights are mainly for Panel views, where this
   * estimate isn't consulted anyway). */
  get mapHeight(): number {
    if (typeof this.height === "number") return this.height;
    return Math.max(200, this.cardSize * 50);
  }

  /** The actual CSS height to render with. */
  get cssHeight(): string {
    if (typeof this.height === "string") return this.height;
    return `${this.mapHeight}px`;
  }
}
