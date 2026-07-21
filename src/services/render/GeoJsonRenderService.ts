import type { GeoJsonConfig } from "../../configs/GeoJsonConfig";
import type { EntityConfig } from "../../configs/EntityConfig";
import type { StyleReattach } from "../../maplibre/StyleReattach";
import { resolveGeoJsonData } from "../../models/GeoJson";
import type { HomeAssistant } from "../../types/home-assistant";
import type { MapSourceLike } from "./HistoryRenderService";
import type { LayerRegistry } from "./LayerRegistry";
import type { EntityTapHandler } from "./EntitiesRenderService";

/** The subset of maplibregl.Map GeoJsonRenderService needs beyond
 * MapSourceLike: layer-scoped click handling to reuse the same
 * hass-more-info tap flow as entity markers (mirrors upstream ha-map-card's
 * GeoJson._handleLayerClick, which shows the entity's popup on click rather
 * than anything feature-specific). */
export interface GeoJsonMapLike extends MapSourceLike {
  on(event: string, layerId: string, handler: () => void): unknown;
  off(event: string, layerId: string, handler: () => void): unknown;
}

const DEFAULT_COLOR = "#3388ff"; // Leaflet's own default path color

function sourceId(entityId: string): string {
  return `geojson-${entityId}`;
}

function fillLayerId(id: string): string {
  return `${id}-fill`;
}

function lineLayerId(id: string): string {
  return `${id}-line`;
}

function circleLayerId(id: string): string {
  return `${id}-circle`;
}

function layerIds(id: string): string[] {
  return [fillLayerId(id), lineLayerId(id), circleLayerId(id)];
}

/** Fill/line/circle layers dispatched by GeoJSON geometry type, all reading
 * the same source — MapLibre has no single "draw whatever geometry this is"
 * layer type the way Leaflet's L.geoJSON does, so each layer filters to the
 * geometry types it can render (a line layer also picks up polygon rings, as
 * an outline — matching Leaflet path styling, where stroke and fill are
 * drawn together). */
function toLayers(id: string, config: GeoJsonConfig, visible: boolean) {
  const visibility = visible ? ("visible" as const) : ("none" as const);
  const color = config.color ?? DEFAULT_COLOR;
  return [
    {
      id: fillLayerId(id),
      type: "fill" as const,
      source: id,
      filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
      paint: { "fill-color": color, "fill-opacity": config.fillOpacity },
      layout: { visibility },
    },
    {
      id: lineLayerId(id),
      type: "line" as const,
      source: id,
      filter: [
        "match",
        ["geometry-type"],
        ["LineString", "MultiLineString", "Polygon", "MultiPolygon"],
        true,
        false,
      ],
      paint: { "line-color": color, "line-width": config.weight, "line-opacity": config.opacity },
      layout: { visibility },
    },
    {
      id: circleLayerId(id),
      type: "circle" as const,
      source: id,
      filter: ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
      paint: {
        "circle-radius": 6,
        "circle-color": color,
        "circle-opacity": 0.8,
        "circle-stroke-color": color,
        "circle-stroke-width": config.weight,
        "circle-stroke-opacity": config.opacity,
      },
      layout: { visibility },
    },
  ];
}

/** Identity of every paint value toLayers() bakes in, as a single comparable
 * string — same "store a visual key, redraw only when it changes" precedent as
 * MarkerFactory.markerVisualKey. JSON rather than a delimiter join because a
 * CSS colour can itself contain commas and spaces (`rgb(1, 2, 3)`), so two
 * distinct field tuples could otherwise collide by concatenation. */
function paintKey(config: GeoJsonConfig): string {
  return JSON.stringify([config.color ?? DEFAULT_COLOR, config.fillOpacity, config.weight, config.opacity]);
}

/**
 * Renders an entity attribute containing GeoJSON (`geojson:` config) as a
 * native GeoJSON source with geometry-type-dispatched layers, keyed
 * `geojson-${entityId}`. Like history trails and circles, sources/layers are
 * wiped by every map.setStyle() (theme swap), so the most recent geometry is
 * registered with StyleReattach for replay on "style.load", and registered
 * with LayerRegistry as a toggleable overlay. Click handlers are attached
 * once to the live Map instance (not the style), so — unlike sources/layers
 * — they survive setStyle() on their own and don't need replaying.
 */
export class GeoJsonRenderService {
  private readonly active = new Set<string>();
  private readonly visibility = new Map<string, boolean>();
  private readonly clickHandlers = new Map<string, () => void>();
  /** Paint identity (see `paintKey`) each source's layers were last drawn
   * with. Paint used to be applied only on the addLayer() path, so editing
   * `geojson: {color, weight, opacity, fill_opacity}` left the existing shape
   * drawn with the old values until a theme swap replayed the reattach
   * factory. */
  private readonly paintKeys = new Map<string, string>();

  constructor(
    private readonly map: GeoJsonMapLike,
    private readonly reattach: StyleReattach,
    private readonly layerRegistry: LayerRegistry,
    private readonly onTap: EntityTapHandler,
  ) {}

  update(entities: EntityConfig[], hass: HomeAssistant): void {
    const seen = new Set<string>();
    for (const ent of entities) {
      if (!ent.geojson) continue;
      const data = resolveGeoJsonData(ent.geojson, hass.states[ent.id]);
      if (!data) continue;

      seen.add(ent.id);
      this._upsert(ent.id, data, ent.geojson);
    }
    for (const entityId of [...this.active]) {
      if (!seen.has(entityId)) this._remove(entityId);
    }
  }

  removeAll(): void {
    for (const entityId of [...this.active]) this._remove(entityId);
  }

  has(entityId: string): boolean {
    return this.active.has(entityId);
  }

  private _upsert(entityId: string, data: object, config: GeoJsonConfig): void {
    const id = sourceId(entityId);
    const isVisible = () => this.visibility.get(id) ?? true;

    const paint = paintKey(config);
    const existingSource = this.map.getSource(id);
    if (existingSource) {
      existingSource.setData(data);
      // setData() only carries geometry; the layers keep whatever paint they
      // were added with, so a restyle has to be pushed onto them explicitly.
      if (this.paintKeys.get(id) !== paint) this._applyPaint(id, config);
    } else {
      this.map.addSource(id, { type: "geojson", data });
      for (const layer of toLayers(id, config, isVisible())) this.map.addLayer(layer);
      this._wireClick(id, entityId);
      this.active.add(entityId);
    }
    this.paintKeys.set(id, paint);

    // Re-registering on every update keeps the replayed geometry current — a
    // later style.load replays whatever was most recently upserted here.
    // Click handlers aren't re-attached here: they live on the Map instance
    // itself (see class doc), not the style, so they survive on their own.
    this.reattach.register(id, (map) => {
      const m = map as unknown as GeoJsonMapLike;
      if (m.getSource(id)) return;
      m.addSource(id, { type: "geojson", data });
      for (const layer of toLayers(id, config, isVisible())) m.addLayer(layer);
    });

    this.layerRegistry.registerOverlay(id, {
      label: `GeoJSON: ${entityId}`,
      group: "geojson",
      setVisible: (map, visible) => {
        this.visibility.set(id, visible);
        const m = map as GeoJsonMapLike;
        const layout = visible ? "visible" : "none";
        for (const layerId of layerIds(id)) m.setLayoutProperty(layerId, "visibility", layout);
      },
    });
  }

  /** Mirrors toLayers()' paint blocks for the fields that are config-driven
   * (the fixed ones — circle-radius, circle-opacity — can't change). */
  private _applyPaint(id: string, config: GeoJsonConfig): void {
    const color = config.color ?? DEFAULT_COLOR;
    this.map.setPaintProperty(fillLayerId(id), "fill-color", color);
    this.map.setPaintProperty(fillLayerId(id), "fill-opacity", config.fillOpacity);
    this.map.setPaintProperty(lineLayerId(id), "line-color", color);
    this.map.setPaintProperty(lineLayerId(id), "line-width", config.weight);
    this.map.setPaintProperty(lineLayerId(id), "line-opacity", config.opacity);
    this.map.setPaintProperty(circleLayerId(id), "circle-color", color);
    this.map.setPaintProperty(circleLayerId(id), "circle-stroke-color", color);
    this.map.setPaintProperty(circleLayerId(id), "circle-stroke-width", config.weight);
    this.map.setPaintProperty(circleLayerId(id), "circle-stroke-opacity", config.opacity);
  }

  private _wireClick(id: string, entityId: string): void {
    const handler = () => this.onTap(entityId);
    for (const layerId of layerIds(id)) this.map.on("click", layerId, handler);
    this.clickHandlers.set(id, handler);
  }

  private _remove(entityId: string): void {
    const id = sourceId(entityId);
    this.reattach.unregister(id);
    this.layerRegistry.unregister(id);
    this.visibility.delete(id);
    this.paintKeys.delete(id);
    this.active.delete(entityId);

    const handler = this.clickHandlers.get(id);
    if (handler) {
      for (const layerId of layerIds(id)) this.map.off("click", layerId, handler);
      this.clickHandlers.delete(id);
    }

    if (this.map.getSource(id)) {
      for (const layerId of layerIds(id)) this.map.removeLayer(layerId);
      this.map.removeSource(id);
    }
  }
}
