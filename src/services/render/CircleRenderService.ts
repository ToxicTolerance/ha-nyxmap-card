import { CircleConfig } from "../../configs/CircleConfig";
import type { EntityConfig } from "../../configs/EntityConfig";
import { colorFromString } from "../../maplibre/MarkerFactory";
import { resolveCircleRadius } from "../../models/Circle";
import type { HomeAssistant } from "../../types/home-assistant";
import { circlePolygonCoordinates } from "../../util/geo";
import { circleSourceId } from "./OverlayIds";
import { type OverlayBuild, OverlaySource } from "./OverlaySource";

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
      layer: {
        id: fillLayerId(id),
        type: "fill" as const,
        source: id,
        paint: { "fill-color": color, "fill-opacity": fillOpacity },
        layout: { visibility },
      },
    },
    {
      id: lineLayerId(id),
      layer: {
        id: lineLayerId(id),
        type: "line" as const,
        source: id,
        paint: { "line-color": color, "line-width": 2, "line-opacity": 0.8 },
        layout: { visibility },
      },
    },
  ];
}

/** One circle's config-driven inputs, carried through OverlaySource so the
 * reattach factory can rebuild the geometry at replay time. */
interface CircleItem {
  center: [number, number];
  radiusMeters: number;
  color: string;
  fillOpacity: number;
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
export class CircleRenderService extends OverlaySource<string, CircleItem> {
  protected sourceIdFor(entityId: string): string {
    return circleSourceId(entityId);
  }

  protected build(entityId: string, item: CircleItem, visible: boolean): OverlayBuild {
    const id = this.sourceIdFor(entityId);
    return {
      source: { type: "geojson", data: toGeoJson(item.center, item.radiusMeters) },
      layers: toLayers(id, item.color, item.fillOpacity, visible),
      label: `Circle: ${entityId}`,
      group: "circle",
      // A circle's source carries nothing but its data, so it never needs a
      // rebuild — setData() alone always suffices.
      sourceKey: "geojson",
      paintKey: JSON.stringify([item.color, item.fillOpacity]),
    };
  }

  protected updateSourceData(source: unknown, build: OverlayBuild): void {
    (source as { setData(data: unknown): void }).setData((build.source as { data: unknown }).data);
  }

  /** setData() only carries geometry; the layers keep whatever paint they were
   * added with, so a recolour has to be pushed onto them explicitly. */
  protected applyPaint(id: string, item: CircleItem): void {
    this.map.setPaintProperty(fillLayerId(id), "fill-color", item.color);
    this.map.setPaintProperty(fillLayerId(id), "fill-opacity", item.fillOpacity);
    this.map.setPaintProperty(lineLayerId(id), "line-color", item.color);
  }

  update(
    entities: EntityConfig[],
    hass: HomeAssistant,
    showAccuracyCircles: boolean,
    absorbed?: ReadonlyMap<string, unknown>,
  ): void {
    const seen = new Set<string>();
    for (const ent of entities) {
      // An entity absorbed into a cluster bubble has its individual marker
      // hidden, so its accuracy circle must hide too — otherwise circles linger
      // at the real positions of markers that are no longer shown. Skipping it
      // here (not adding to `seen`) makes the cleanup loop below remove it.
      if (absorbed?.has(ent.id)) continue;
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
      this.upsert(ent.id, {
        center: [lng as number, lat as number],
        radiusMeters: radius,
        color: circleCfg.color ?? colorFromString(ent.id),
        fillOpacity: circleCfg.fillOpacity,
      });
    }
    this.reconcile(seen);
  }
}
