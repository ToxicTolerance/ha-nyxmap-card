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

function sourceId(kind: LayerKind, index: number): string {
  return `${kind}-layer-${index}`;
}

/** Builds a WMS GetMap request as a MapLibre raster tile-URL template,
 * anchored on the `{bbox-epsg-3857}` token MapLibre substitutes per-tile —
 * deliberately not hand-rolled BBOX math (see CLAUDE.md / the phase plan).
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
 * sources/layers on top of the vector base style, keyed `tile-layer-${i}`/
 * `wms-layer-${i}`. Like history trails, circles, and GeoJSON shapes,
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

    tileLayers.forEach((cfg, index) => {
      const id = sourceId("tile", index);
      seen.add(id);
      this._upsert(id, resolver.resolveUrl(cfg.url), cfg.options, `Tile layer ${index + 1}`);
    });
    wmsLayers.forEach((cfg, index) => {
      const id = sourceId("wms", index);
      seen.add(id);
      this._upsert(id, buildWmsUrl(resolver.resolveUrl(cfg.url), cfg.options), cfg.options, `WMS layer ${index + 1}`);
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
