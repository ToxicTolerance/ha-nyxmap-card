import type { EntityHistory } from "../../models/EntityHistory";
import type { StyleReattach } from "../../maplibre/StyleReattach";
import type { LayerRegistry } from "./LayerRegistry";

/** The subset of maplibregl.Map HistoryRenderService needs. */
export interface MapSourceLike {
  addSource(id: string, source: unknown): unknown;
  addLayer(layer: unknown): unknown;
  getSource(id: string): { setData(data: unknown): void } | undefined;
  removeLayer(id: string): unknown;
  removeSource(id: string): unknown;
  setLayoutProperty(layerId: string, name: string, value: unknown): unknown;
  setPaintProperty(layerId: string, name: string, value: unknown): unknown;
}

function sourceId(entityId: string): string {
  return `history-${entityId}`;
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

/** Identity of every paint value the trail's layers are built from, as a
 * single comparable string — mirrors MarkerFactory.markerVisualKey. */
function paintKey(history: EntityHistory): string {
  return history.lineColor;
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
export class HistoryRenderService {
  private readonly active = new Set<string>();
  private readonly visibility = new Map<string, boolean>();
  /** Layer ids currently added per source id — history_show_lines/_dots can
   * differ per update (e.g. a config edit), so layers are reconciled against
   * this rather than assumed to be exactly one fixed line layer. */
  private readonly layers = new Map<string, string[]>();
  /** Paint identity (see `paintKey`) each source's layers were last drawn
   * with — the same "store a visual key, redraw only when it changes"
   * precedent EntitiesRenderService uses for markers (markerVisualKey). Paint
   * used to be applied only on the addLayer() path, so changing
   * `history_line_color` on an existing trail did nothing until a theme swap
   * replayed the reattach factory with the fresh value. */
  private readonly paintKeys = new Map<string, string>();

  constructor(
    private readonly map: MapSourceLike,
    private readonly reattach: StyleReattach,
    private readonly layerRegistry: LayerRegistry,
  ) {}

  update(histories: Map<string, EntityHistory>): void {
    const seen = new Set<string>();
    for (const history of histories.values()) {
      if (!history.hasPath) continue;
      seen.add(history.entityId);
      this._upsert(history);
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

  /** The line layer (id === source id, when shown) and the dots layer (when
   * shown), as `{id, layer}` pairs — built fresh each call so a StyleReattach
   * replay always gets the current showLines/showDots + visibility. */
  private _layerSpecs(id: string, history: EntityHistory, isVisible: () => boolean): Array<{ id: string; layer: unknown }> {
    const specs: Array<{ id: string; layer: unknown }> = [];
    if (history.showLines) specs.push({ id, layer: toLineLayer(id, history.lineColor, isVisible()) });
    if (history.showDots) specs.push({ id: dotsLayerId(id), layer: toDotsLayer(id, history.lineColor, isVisible()) });
    return specs;
  }

  private _upsert(history: EntityHistory): void {
    const id = sourceId(history.entityId);
    const geojson = toGeoJson(history.coordinates, history.showLines, history.showDots);
    const isVisible = () => this.visibility.get(id) ?? true;

    const existingSource = this.map.getSource(id);
    if (existingSource) {
      existingSource.setData(geojson);
    } else {
      this.map.addSource(id, { type: "geojson", data: geojson });
      this.active.add(history.entityId);
    }

    // Reconciled against the previously-added layer ids rather than assumed
    // fixed, since history_show_lines/_dots can change between updates.
    const desired = this._layerSpecs(id, history, isVisible);
    const desiredIds = desired.map((d) => d.id);
    const previousIds = this.layers.get(id) ?? [];
    for (const layerId of previousIds) {
      if (!desiredIds.includes(layerId)) this.map.removeLayer(layerId);
    }
    for (const spec of desired) {
      if (!previousIds.includes(spec.id)) this.map.addLayer(spec.layer);
    }
    this.layers.set(id, desiredIds);

    // Layers added just above already carry the current colour; only the ones
    // that survived from the previous update need it pushed onto them.
    const paint = paintKey(history);
    if (this.paintKeys.get(id) !== paint) {
      for (const layerId of desiredIds) {
        if (!previousIds.includes(layerId)) continue;
        if (layerId === id) this.map.setPaintProperty(layerId, "line-color", history.lineColor);
        else this.map.setPaintProperty(layerId, "circle-color", history.lineColor);
      }
    }
    this.paintKeys.set(id, paint);

    // Re-registering on every update keeps the replayed data current — a
    // later style.load replays whatever was most recently upserted here.
    this.reattach.register(id, (map) => {
      const m = map as unknown as MapSourceLike;
      if (m.getSource(id)) return;
      m.addSource(id, { type: "geojson", data: geojson });
      for (const spec of this._layerSpecs(id, history, isVisible)) m.addLayer(spec.layer);
    });

    this.layerRegistry.registerOverlay(id, {
      label: `History: ${history.entityId}`,
      group: "history",
      setVisible: (map, visible) => {
        this.visibility.set(id, visible);
        const m = map as MapSourceLike;
        for (const layerId of this.layers.get(id) ?? []) {
          m.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
        }
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
      for (const layerId of this.layers.get(id) ?? []) this.map.removeLayer(layerId);
      this.map.removeSource(id);
    }
    this.layers.delete(id);
    this.paintKeys.delete(id);
  }
}
