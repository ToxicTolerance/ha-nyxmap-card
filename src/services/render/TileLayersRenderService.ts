import type { LayerConfig } from "../../configs/LayerConfig";
import { HaUrlResolveService } from "../HaUrlResolveService";
import type { HomeAssistant } from "../../types/home-assistant";
import { rasterSourceId } from "./OverlayIds";
import { type OverlayBuild, type OverlayMapLike, OverlaySource } from "./OverlaySource";

/** The subset of maplibregl.Map TileLayersRenderService needs: the shared
 * overlay surface, narrowed so `getSource()` exposes raster's `setTiles()`
 * rather than the `setData()` the GeoJSON-backed services use. */
export interface TileLayersMapLike extends OverlayMapLike {
  getSource(id: string): { setTiles(tiles: string[]): void } | undefined;
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
 * `tile-layer-`/`wms-layer-` prefixes come from OverlayIds, which is also what
 * PluginHost reads to reject colliding plugin overlay ids. */
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

/** Builds a WMS GetMap request as a MapLibre raster tile-URL template,
 * anchored on the `{bbox-epsg-3857}` token MapLibre substitutes per-tile —
 * deliberately not hand-rolled BBOX math.
 * `options` supplies WMS params (layers/format/transparent/version/styles);
 * anything not WMS-specific (e.g. `attribution`) is harmless as an unused
 * query param here and is applied separately as the source's own
 * `attribution` field by the caller. */
function buildWmsUrl(baseUrl: string, options: Record<string, unknown>): string {
  // WMS params come out of a free-form YAML `options:` bag, so a value can be
  // any shape the user typed. Only primitives make sense in a query string —
  // a nested map or list would otherwise stringify to "[object Object]" and
  // produce a request the server rejects with no hint as to why, so anything
  // non-primitive falls back to the default instead.
  const param = (value: unknown, fallback: string | number | boolean): string => {
    if (value === undefined || value === null) return String(fallback);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    console.warn("[nyxmap-card] ignoring non-primitive WMS option:", value);
    return String(fallback);
  };

  const params = new URLSearchParams();
  params.set("SERVICE", "WMS");
  params.set("REQUEST", "GetMap");
  params.set("VERSION", param(options.version, "1.1.1"));
  params.set("LAYERS", param(options.layers, ""));
  params.set("STYLES", param(options.styles, ""));
  params.set("FORMAT", param(options.format, "image/png"));
  params.set("TRANSPARENT", param(options.transparent, true));
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
    layer: {
      id,
      type: "raster" as const,
      source: id,
      layout: { visibility: visible ? ("visible" as const) : ("none" as const) },
    },
  };
}

/** One raster layer's resolved URL plus the option bag it's built from. */
interface RasterItem {
  url: string;
  options: Record<string, unknown>;
  label: string;
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
export class TileLayersRenderService extends OverlaySource<string, RasterItem> {
  /** Raster ids are already fully-formed source ids (built by `uniqueId()`
   * below, which has to disambiguate duplicates), so the key *is* the id. */
  protected sourceIdFor(id: string): string {
    return id;
  }

  protected build(id: string, item: RasterItem, visible: boolean): OverlayBuild {
    const attribution = typeof item.options.attribution === "string" ? item.options.attribution : undefined;
    const zoomRange = extractZoomRange(item.options);
    return {
      source: { type: "raster" as const, tiles: [item.url], tileSize: 256, attribution, ...zoomRange },
      layers: [toRasterLayer(id, visible)],
      label: item.label,
      group: "raster",
      // Unlike the GeoJSON-backed overlays, a raster source carries state with
      // no setter: minzoom/maxzoom/attribution are read once at addSource()
      // time and setTiles() only replaces the URL. Editing `maxzoom` on a live
      // layer therefore used to do nothing until a theme swap or page reload
      // replayed the reattach factory. Folding them into sourceKey makes
      // OverlaySource tear the source down and re-add it instead.
      sourceKey: JSON.stringify([zoomRange.minzoom, zoomRange.maxzoom, attribution]),
      // Raster layers have no config-driven paint — everything visual lives on
      // the source.
      paintKey: "raster",
    };
  }

  protected updateSourceData(source: unknown, build: OverlayBuild): void {
    const tiles = (build.source as { tiles: string[] }).tiles;
    (source as { setTiles(tiles: string[]): void }).setTiles(tiles);
  }

  update(tileLayers: LayerConfig[], wmsLayers: LayerConfig[], hass: HomeAssistant): void {
    const resolver = new HaUrlResolveService(hass);
    const seen = new Set<string>();
    // Two layers can legitimately share a url (and hence a hashed token) —
    // disambiguated positionally, which is the one case where index-keying is
    // unavoidable and also harmless (they're interchangeable by definition).
    const used = new Map<string, number>();
    const uniqueId = (kind: LayerKind, cfg: LayerConfig): string => {
      const base = rasterSourceId(kind, identityToken(cfg));
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      return n === 0 ? base : `${base}-${n}`;
    };

    tileLayers.forEach((cfg, index) => {
      const id = uniqueId("tile", cfg);
      seen.add(id);
      this.upsert(id, {
        url: resolver.resolveUrl(cfg.url),
        options: cfg.options,
        label: layerLabel(cfg, "Tile layer", index),
      });
    });
    wmsLayers.forEach((cfg, index) => {
      const id = uniqueId("wms", cfg);
      seen.add(id);
      this.upsert(id, {
        url: buildWmsUrl(resolver.resolveUrl(cfg.url), cfg.options),
        options: cfg.options,
        label: layerLabel(cfg, "WMS layer", index),
      });
    });

    this.reconcile(seen);
  }
}
