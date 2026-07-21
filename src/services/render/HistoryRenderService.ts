import type { EntityHistory } from "../../models/EntityHistory";
import { historySourceId } from "./OverlayIds";
import { type OverlayBuild, type OverlayMapLike, OverlaySource } from "./OverlaySource";

/** The subset of maplibregl.Map the GeoJSON-source render services need: the
 * shared overlay surface, narrowed so `getSource()` exposes `setData()`. */
export interface MapSourceLike extends OverlayMapLike {
  getSource(id: string): { setData(data: unknown): void } | undefined;
}

function dotsLayerId(id: string): string {
  return `${id}-dots`;
}

function toGeoJson(coordinates: Array<[number, number]>, showLines: boolean, showDots: boolean) {
  const features: unknown[] = [];
  if (showLines) {
    features.push({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates },
    });
  }
  if (showDots) {
    for (const coordinate of coordinates) {
      features.push({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point" as const, coordinates: coordinate },
      });
    }
  }
  return { type: "FeatureCollection" as const, features };
}

function toLineLayer(id: string, lineColor: string, visible: boolean) {
  return {
    id,
    type: "line" as const,
    source: id,
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": lineColor, "line-width": 3, "line-opacity": 0.8 },
    layout: {
      "line-cap": "round" as const,
      "line-join": "round" as const,
      visibility: visible ? ("visible" as const) : ("none" as const),
    },
  };
}

function toDotsLayer(id: string, lineColor: string, visible: boolean) {
  return {
    id: dotsLayerId(id),
    type: "circle" as const,
    source: id,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 4,
      "circle-color": lineColor,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
    },
    layout: {
      visibility: visible ? ("visible" as const) : ("none" as const),
    },
  };
}

/**
 * Renders per-entity history trails as GeoJSON LineString sources/layers.
 * Unlike markers, sources/layers are wiped by every map.setStyle() (theme
 * swap) — each entity's most recent trail is registered with StyleReattach
 * so it gets replayed on "style.load" instead of silently disappearing.
 *
 * Each trail is also registered with LayerRegistry as a toggleable overlay
 * (the layer switcher). Visibility is tracked here rather than just left to
 * MapLibre's layer state, so a StyleReattach replay after a theme swap
 * recreates a hidden trail still hidden instead of it silently reappearing.
 */
export class HistoryRenderService extends OverlaySource<string, EntityHistory> {
  protected sourceIdFor(entityId: string): string {
    return historySourceId(entityId);
  }

  protected build(entityId: string, history: EntityHistory, visible: boolean): OverlayBuild {
    const id = this.sourceIdFor(entityId);
    // The layer set is not fixed: history_show_lines/_dots can change between
    // updates (a config edit), so OverlaySource reconciles against whatever
    // this returns rather than assuming one line layer.
    const layers: OverlayBuild["layers"] = [];
    if (history.showLines) layers.push({ id, layer: toLineLayer(id, history.lineColor, visible) });
    if (history.showDots) {
      layers.push({ id: dotsLayerId(id), layer: toDotsLayer(id, history.lineColor, visible) });
    }
    return {
      source: {
        type: "geojson",
        data: toGeoJson(history.coordinates, history.showLines, history.showDots),
      },
      layers,
      label: `History: ${entityId}`,
      group: "history",
      sourceKey: "geojson",
      paintKey: history.lineColor,
    };
  }

  protected updateSourceData(source: unknown, build: OverlayBuild): void {
    (source as { setData(data: unknown): void }).setData((build.source as { data: unknown }).data);
  }

  protected applyPaint(id: string, history: EntityHistory, survivingLayerIds: string[]): void {
    for (const layerId of survivingLayerIds) {
      if (layerId === id) this.map.setPaintProperty(layerId, "line-color", history.lineColor);
      else this.map.setPaintProperty(layerId, "circle-color", history.lineColor);
    }
  }

  update(histories: Map<string, EntityHistory>): void {
    const seen = new Set<string>();
    for (const history of histories.values()) {
      if (!history.hasPath) continue;
      seen.add(history.entityId);
      this.upsert(history.entityId, history);
    }
    this.reconcile(seen);
  }
}
