import { EntityConfig, type EntityConfigRaw } from "./EntityConfig";
import { type LayerConfigRaw, parseLayerConfigList } from "./LayerConfig";
import { TileLayerConfig } from "./TileLayerConfig";
import { WmsLayerConfig } from "./WmsLayerConfig";

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
  /** Per-style zoom cap, independent of the card-level max_zoom/min_zoom —
   * different base styles can have genuinely different real coverage (e.g. a
   * regional aerial-imagery style topping out well below a general-purpose
   * vector style), so a single global cap can't fit all of them at once. */
  max_zoom?: number;
  min_zoom?: number;
}

/** Every `.nyxmap-marker` is a circle exactly `EntityConfig.size` px in
 * diameter (see MarkerFactory.buildMarkerElement), so two same-size markers
 * touch when their screen centers are `size` px apart — MapLibre's
 * clusterRadius is measured in the same CSS-pixel units (see
 * ClusterRenderService), making "largest configured marker size" a direct,
 * no-guesswork stand-in for "cluster only once markers would actually
 * touch." Falls back to EntityConfig's own default size when there are no
 * entities yet (e.g. a brand-new card) or none set a custom `size`. */
function defaultClusterRadius(entities: EntityConfig[]): number {
  return entities.length > 0 ? Math.max(...entities.map((e) => e.size)) : 48;
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
  history_start?: string;
  history_end?: string;
  /** Whether to draw the connecting trail line / a dot per sampled position.
   * Card-level only, applied to every entity's history — matches upstream.
   * Defaults mirror upstream: lines on, dots off. */
  history_show_lines?: boolean;
  history_show_dots?: boolean;
  /** Opt-in low-zoom marker clustering: nearby entities collapse into a
   * numbered bubble, matching upstream ha-map-card's own opt-in default. */
  cluster_markers?: boolean;
  /** MapLibre cluster-source tuning, only relevant when cluster_markers is
   * on. Pixel radius (per integer zoom level) within which entities collapse
   * into one bubble. Defaults to the largest configured entity `size` (see
   * defaultClusterRadius below), which approximates "cluster once markers
   * would touch" for same-size markers — set explicitly to override that.
   * See ClusterRenderService's class doc for why this can't fully track each
   * entity's actual marker size at every zoom. */
  cluster_radius?: number;
  /** Zoom level at and above which clustering stops entirely, regardless of
   * how close entities are. */
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
  readonly historyShowLines: boolean;
  readonly historyShowDots: boolean;
  readonly clusterMarkers: boolean;
  readonly clusterRadius: number;
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
    this.mapStyles = (raw.map_styles ?? []).map((s) => ({
      name: s.name,
      styleLight: s.map_style,
      styleDark: s.map_style_dark ?? s.map_style,
      maxZoom: s.max_zoom,
      minZoom: s.min_zoom,
    }));
    this.projection = raw.projection ?? "globe";
    this.layerSwitcher = raw.layer_switcher ?? false;
    this.historyStart = raw.history_start;
    this.historyEnd = raw.history_end;
    this.historyShowLines = raw.history_show_lines ?? true;
    this.historyShowDots = raw.history_show_dots ?? false;
    this.entities = (raw.entities ?? []).map(EntityConfig.from);
    this.clusterMarkers = raw.cluster_markers ?? false;
    this.clusterRadius = raw.cluster_radius ?? defaultClusterRadius(this.entities);
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
