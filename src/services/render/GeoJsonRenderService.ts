import type { GeoJsonConfig } from "../../configs/GeoJsonConfig";
import type { EntityConfig } from "../../configs/EntityConfig";
import type { StyleReattach } from "../../maplibre/StyleReattach";
import { resolveGeoJsonData } from "../../models/GeoJson";
import type { HomeAssistant } from "../../types/home-assistant";
import type { MapSourceLike } from "./HistoryRenderService";
import type { LayerRegistry } from "./LayerRegistry";
import { geoJsonSourceId } from "./OverlayIds";
import { type OverlayBuild, OverlaySource } from "./OverlaySource";
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
      layer: {
        id: fillLayerId(id),
        type: "fill" as const,
        source: id,
        filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
        paint: { "fill-color": color, "fill-opacity": config.fillOpacity },
        layout: { visibility },
      },
    },
    {
      id: lineLayerId(id),
      layer: {
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
    },
    {
      id: circleLayerId(id),
      layer: {
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
    },
  ];
}

/** One entity's resolved GeoJSON plus the styling config it's drawn with. */
interface GeoJsonItem {
  data: object;
  config: GeoJsonConfig;
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
export class GeoJsonRenderService extends OverlaySource<string, GeoJsonItem> {
  private readonly clickHandlers = new Map<string, () => void>();

  constructor(
    private readonly geoJsonMap: GeoJsonMapLike,
    reattach: StyleReattach,
    layerRegistry: LayerRegistry,
    private readonly onTap: EntityTapHandler,
  ) {
    super(geoJsonMap, reattach, layerRegistry);
  }

  protected sourceIdFor(entityId: string): string {
    return geoJsonSourceId(entityId);
  }

  protected build(entityId: string, item: GeoJsonItem, visible: boolean): OverlayBuild {
    const id = this.sourceIdFor(entityId);
    return {
      source: { type: "geojson", data: item.data },
      layers: toLayers(id, item.config, visible),
      label: `GeoJSON: ${entityId}`,
      group: "geojson",
      sourceKey: "geojson",
      paintKey: JSON.stringify([
        item.config.color ?? DEFAULT_COLOR,
        item.config.fillOpacity,
        item.config.weight,
        item.config.opacity,
      ]),
    };
  }

  protected updateSourceData(source: unknown, build: OverlayBuild): void {
    (source as { setData(data: unknown): void }).setData((build.source as { data: unknown }).data);
  }

  /** Mirrors toLayers()' paint blocks for the fields that are config-driven
   * (the fixed ones — circle-radius, circle-opacity — can't change). */
  protected applyPaint(id: string, item: GeoJsonItem): void {
    const config = item.config;
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

  /** Click handlers live on the Map instance itself (see class doc), not the
   * style, so they are wired once here rather than in the reattach factory —
   * they survive setStyle() on their own. */
  protected onAdded(id: string, entityId: string): void {
    const handler = () => this.onTap(entityId);
    for (const layerId of layerIds(id)) this.geoJsonMap.on("click", layerId, handler);
    this.clickHandlers.set(id, handler);
  }

  protected onRemoving(id: string): void {
    const handler = this.clickHandlers.get(id);
    if (!handler) return;
    for (const layerId of layerIds(id)) this.geoJsonMap.off("click", layerId, handler);
    this.clickHandlers.delete(id);
  }

  update(entities: EntityConfig[], hass: HomeAssistant): void {
    const seen = new Set<string>();
    for (const ent of entities) {
      if (!ent.geojson) continue;
      const data = resolveGeoJsonData(ent.geojson, hass.states[ent.id]);
      if (!data) continue;

      seen.add(ent.id);
      this.upsert(ent.id, { data, config: ent.geojson });
    }
    this.reconcile(seen);
  }
}
