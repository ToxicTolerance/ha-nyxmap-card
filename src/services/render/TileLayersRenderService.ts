import type { LayerConfig } from "../../configs/LayerConfig";
import type { StyleReattach } from "../../maplibre/StyleReattach";
import { HaUrlResolveService } from "../HaUrlResolveService";
import type { HomeAssistant } from "../../types/home-assistant";
import type { LayerRegistry } from "./LayerRegistry";

/** The subset of maplibregl.Map TileLayersRenderService needs. Raster
 * sources use setTiles(), not the setData() other render services' sources
 * use — a distinct interface from MapSourceLike (used by History/Circle/
 * GeoJson) rather than a false-shared one. */
export interface TileLayersMapLike {
  addSource(id: string, source: unknown): unknown;
  addLayer(layer: unknown): unknown;
  getSource(id: string): { setTiles(tiles: string[]): void } | undefined;
  removeLayer(id: string): unknown;
  removeSource(id: string): unknown;
  setLayoutProperty(layerId: string, name: string, value: unknown): unknown;
}

type LayerKind = "tile" | "wms";

/** Stable per-layer identity token. Ids used to be `${kind}-layer-${index}`,
 * which made every piece of per-layer state — the switcher's visibility map,
 * the StyleReattach factory, the LayerRegistry entry — follow the *position*
 * in the YAML list rather than the layer. Reordering `tile_layers:` therefore
 * re-pointed a hidden layer's "hidden" flag at whichever layer had moved into
 * that slot. Keyed off `options.name` when the user supplies one, else a hash
 * of the layer's own (pre-template-resolution) URL, so identity survives both
 * reordering and a `{{ states(...) }}` URL whose resolved value changes. The
 * `tile-layer-`/`wms-layer-` prefixes are kept verbatim: they're part of the
 * reserved-id namespace documented for plugin authors (see
 * types/nyxmap-plugin.d.ts and PluginHost's RESERVED_OVERLAY_ID_PREFIXES). */
function identityToken(cfg: { url: string; options: Record<string, unknown> }): string {
  const name = typeof cfg.options.name === "string" ? cfg.options.name.trim() : "";
  return name ? name.replace(/[^A-Za-z0-9_-]+/g, "-").toLowerCase() : hashToken(cfg.url);
}

/** djb2-ish string hash rendered base36 — short, stable, and collision-proof
 * enough for the handful of raster layers a card carries (exact duplicates are
 * disambiguated by the caller anyway). */
function hashToken(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function sourceId(kind: LayerKind, token: string): string {
  return `${kind}-layer-${token}`;
}

/** Builds a WMS GetMap request as a MapLibre raster tile-URL template,
 * anchored on the `{bbox-epsg-3857}` token MapLibre substitutes per-tile —
 * deliberately not hand-rolled BBOX math.
 * `options` supplies WMS params (layers/format/transparent/version/styles);
 * anything not WMS-specific (e.g. `attribution`) is harmless as an unused
 * query param here and is applied separately as the source's own
 * `attribution` field by the caller. */
function buildWmsUrl(baseUrl: string, options: Record<string, unknown>): string {
  const params = new URLSearchParams();
  params.set("SERVICE", "WMS");
  params.set("REQUEST", "GetMap");
  params.set("VERSION", String(options.version ?? "1.1.1"));
  params.set("LAYERS", String(options.layers ?? ""));
  params.set("STYLES", String(options.styles ?? ""));
  params.set("FORMAT", String(options.format ?? "image/png"));
  params.set("TRANSPARENT", String(options.transparent ?? true));
  params.set("WIDTH", "256");
  params.set("HEIGHT", "256");
  params.set("CRS", "EPSG:3857");
  const separator = baseUrl.includes("?") ? "&" : "?";
  // {bbox-epsg-3857} must stay a literal token for MapLibre to substitute —
  // appended outside URLSearchParams so it isn't percent-encoded.
  return `${baseUrl}${separator}${params.toString()}&BBOX={bbox-epsg-3857}`;
}

/** Pulls MapLibre's raster-source zoom-range fields out of a layer's
 * `options` bag so they land on the source itself instead of being silently
 * dropped — without this, a source whose real tile coverage stops short of
 * the map's own zoom range (e.g. an aerial-imagery WMS/tile provider that
 * only has data up to z20) just renders blank past that point instead of
 * MapLibre falling back to the last available tiles. */
function extractZoomRange(options: Record<string, unknown>): { minzoom?: number; maxzoom?: number } {
  const range: { minzoom?: number; maxzoom?: number } = {};
  if (typeof options.minzoom === "number") range.minzoom = options.minzoom;
  if (typeof options.maxzoom === "number") range.maxzoom = options.maxzoom;
  return range;
}

/** Switcher label: the user's own `options.name` when given (which is the
 * point of supporting it — "Radar" beats "Tile layer 2"), else the positional
 * fallback. Unlike the id this deliberately *does* track position, so the
 * switcher list reads in config order after a reorder while each entry's
 * visibility state stays with its own layer. */
function layerLabel(cfg: { options: Record<string, unknown> }, fallbackPrefix: string, index: number): string {
  const name = typeof cfg.options.name === "string" ? cfg.options.name.trim() : "";
  return name || `${fallbackPrefix} ${index + 1}`;
}

function toRasterLayer(id: string, visible: boolean) {
  return {
    id,
    type: "raster" as const,
    source: id,
    layout: { visibility: visible ? ("visible" as const) : ("none" as const) },
  };
}

/**
 * Renders card-level `tile_layers:`/`wms:` config as MapLibre raster
 * sources/layers on top of the vector base style, keyed
 * `tile-layer-${token}`/`wms-layer-${token}` where the token is a stable
 * per-layer identity (see identityToken). Like history trails, circles, and GeoJSON shapes,
 * sources/layers are wiped by every map.setStyle() (theme swap), so each
 * layer's most recent resolved URL is registered with StyleReattach for
 * replay on "style.load", and registered with LayerRegistry as a toggleable
 * overlay — this is the phase multiple simultaneous raster overlays (e.g.
 * several weather layers) actually need the switcher for.
 */
export class TileLayersRenderService {
  private readonly active = new Set<string>();
  private readonly visibility = new Map<string, boolean>();

  constructor(
    private readonly map: TileLayersMapLike,
    private readonly reattach: StyleReattach,
    private readonly layerRegistry: LayerRegistry,
  ) {}

  update(tileLayers: LayerConfig[], wmsLayers: LayerConfig[], hass: HomeAssistant): void {
    const resolver = new HaUrlResolveService(hass);
    const seen = new Set<string>();
    // Two layers can legitimately share a url (and hence a hashed token) —
    // disambiguated positionally, which is the one case where index-keying is
    // unavoidable and also harmless (they're interchangeable by definition).
    const used = new Map<string, number>();
    const uniqueId = (kind: LayerKind, cfg: LayerConfig): string => {
      const base = sourceId(kind, identityToken(cfg));
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      return n === 0 ? base : `${base}-${n}`;
    };

    tileLayers.forEach((cfg, index) => {
      const id = uniqueId("tile", cfg);
      seen.add(id);
      this._upsert(id, resolver.resolveUrl(cfg.url), cfg.options, layerLabel(cfg, "Tile layer", index));
    });
    wmsLayers.forEach((cfg, index) => {
      const id = uniqueId("wms", cfg);
      seen.add(id);
      this._upsert(
        id,
        buildWmsUrl(resolver.resolveUrl(cfg.url), cfg.options),
        cfg.options,
        layerLabel(cfg, "WMS layer", index),
      );
    });

    for (const id of [...this.active]) {
      if (!seen.has(id)) this._remove(id);
    }
  }

  removeAll(): void {
    for (const id of [...this.active]) this._remove(id);
  }

  has(id: string): boolean {
    return this.active.has(id);
  }

  private _upsert(id: string, url: string, options: Record<string, unknown>, label: string): void {
    const isVisible = () => this.visibility.get(id) ?? true;
    const attribution = typeof options.attribution === "string" ? options.attribution : undefined;
    const source = { type: "raster" as const, tiles: [url], tileSize: 256, attribution, ...extractZoomRange(options) };

    const existingSource = this.map.getSource(id);
    if (existingSource) {
      existingSource.setTiles([url]);
    } else {
      this.map.addSource(id, source);
      this.map.addLayer(toRasterLayer(id, isVisible()));
      this.active.add(id);
    }

    // Re-registering on every update keeps the replayed URL current — a
    // later style.load replays whatever was most recently upserted here.
    this.reattach.register(id, (map) => {
      const m = map as unknown as TileLayersMapLike;
      if (m.getSource(id)) return;
      m.addSource(id, source);
      m.addLayer(toRasterLayer(id, isVisible()));
    });

    this.layerRegistry.registerOverlay(id, {
      label,
      group: "raster",
      setVisible: (map, visible) => {
        this.visibility.set(id, visible);
        (map as TileLayersMapLike).setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      },
    });
  }

  private _remove(id: string): void {
    this.reattach.unregister(id);
    this.layerRegistry.unregister(id);
    this.visibility.delete(id);
    this.active.delete(id);
    if (this.map.getSource(id)) {
      this.map.removeLayer(id);
      this.map.removeSource(id);
    }
  }
}
