import { CircleConfig } from "../../configs/CircleConfig";
import type { EntityConfig } from "../../configs/EntityConfig";
import { colorFromString } from "../../maplibre/MarkerFactory";
import type { StyleReattach } from "../../maplibre/StyleReattach";
import { resolveCircleRadius } from "../../models/Circle";
import type { HomeAssistant } from "../../types/home-assistant";
import { circlePolygonCoordinates } from "../../util/geo";
import type { MapSourceLike } from "./HistoryRenderService";
import type { LayerRegistry } from "./LayerRegistry";

function sourceId(entityId: string): string {
  return `circle-${entityId}`;
}

function fillLayerId(id: string): string {
  return `${id}-fill`;
}

function lineLayerId(id: string): string {
  return `${id}-line`;
}

function toGeoJson(center: [number, number], radiusMeters: number) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: circlePolygonCoordinates(center, radiusMeters) },
  };
}

function toLayers(id: string, color: string, fillOpacity: number, visible: boolean) {
  const visibility = visible ? ("visible" as const) : ("none" as const);
  return [
    {
      id: fillLayerId(id),
      type: "fill" as const,
      source: id,
      paint: { "fill-color": color, "fill-opacity": fillOpacity },
      layout: { visibility },
    },
    {
      id: lineLayerId(id),
      type: "line" as const,
      source: id,
      paint: { "line-color": color, "line-width": 2, "line-opacity": 0.8 },
      layout: { visibility },
    },
  ];
}

/**
 * Renders per-entity circles (`circle:` config) as GeoJSON Polygon sources
 * with a fill + outline layer, keyed `circle-${entityId}`. Like history
 * trails, sources/layers are wiped by every map.setStyle() (theme swap), so
 * each circle's most recent geometry is registered with StyleReattach for
 * replay on "style.load", and registered with LayerRegistry as a toggleable
 * overlay (visibility tracked here so a hidden circle stays hidden through a
 * reattach replay).
 */
export class CircleRenderService {
  private readonly active = new Set<string>();
  private readonly visibility = new Map<string, boolean>();

  constructor(
    private readonly map: MapSourceLike,
    private readonly reattach: StyleReattach,
    private readonly layerRegistry: LayerRegistry,
  ) {}

  update(entities: EntityConfig[], hass: HomeAssistant, showAccuracyCircles: boolean): void {
    const seen = new Set<string>();
    for (const ent of entities) {
      // An explicit per-entity `circle:` always wins; otherwise fall back to
      // the card-level default-on behavior (matching HA's own built-in map)
      // unless this entity opted out with `circle: false`.
      const circleCfg =
        ent.circle ?? (!ent.circleDisabled && showAccuracyCircles ? CircleConfig.from("auto", ent.color) : undefined);
      if (!circleCfg) continue;
      const st = hass.states[ent.id];
      const lng = ent.fixedX ?? st?.attributes?.longitude;
      const lat = ent.fixedY ?? st?.attributes?.latitude;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      const radius = resolveCircleRadius(circleCfg, st);
      if (radius <= 0) continue;

      seen.add(ent.id);
      this._upsert(
        ent.id,
        [lng as number, lat as number],
        radius,
        circleCfg.color ?? colorFromString(ent.id),
        circleCfg.fillOpacity,
      );
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

  private _upsert(entityId: string, center: [number, number], radiusMeters: number, color: string, fillOpacity: number): void {
    const id = sourceId(entityId);
    const geojson = toGeoJson(center, radiusMeters);
    const isVisible = () => this.visibility.get(id) ?? true;

    const existingSource = this.map.getSource(id);
    if (existingSource) {
      existingSource.setData(geojson);
    } else {
      this.map.addSource(id, { type: "geojson", data: geojson });
      for (const layer of toLayers(id, color, fillOpacity, isVisible())) this.map.addLayer(layer);
      this.active.add(entityId);
    }

    // Re-registering on every update keeps the replayed geometry current — a
    // later style.load replays whatever was most recently upserted here.
    this.reattach.register(id, (map) => {
      const m = map as unknown as MapSourceLike;
      if (m.getSource(id)) return;
      m.addSource(id, { type: "geojson", data: geojson });
      for (const layer of toLayers(id, color, fillOpacity, isVisible())) m.addLayer(layer);
    });

    this.layerRegistry.registerOverlay(id, {
      label: `Circle: ${entityId}`,
      group: "circle",
      setVisible: (map, visible) => {
        this.visibility.set(id, visible);
        const m = map as MapSourceLike;
        const layout = visible ? "visible" : "none";
        m.setLayoutProperty(fillLayerId(id), "visibility", layout);
        m.setLayoutProperty(lineLayerId(id), "visibility", layout);
      },
    });
  }

  private _remove(entityId: string): void {
    const id = sourceId(entityId);
    this.reattach.unregister(id);
    this.layerRegistry.unregister(id);
    this.visibility.delete(id);
    this.active.delete(entityId);
    if (this.map.getSource(id)) {
      this.map.removeLayer(lineLayerId(id));
      this.map.removeLayer(fillLayerId(id));
      this.map.removeSource(id);
    }
  }
}
