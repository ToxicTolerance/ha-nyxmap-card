import type { EntityHistory } from "../../models/EntityHistory";
import type { StyleReattach } from "../../maplibre/StyleReattach";

/** The subset of maplibregl.Map HistoryRenderService needs. */
export interface MapSourceLike {
  addSource(id: string, source: unknown): unknown;
  addLayer(layer: unknown): unknown;
  getSource(id: string): { setData(data: unknown): void } | undefined;
  removeLayer(id: string): unknown;
  removeSource(id: string): unknown;
}

function sourceId(entityId: string): string {
  return `history-${entityId}`;
}

function toGeoJson(coordinates: Array<[number, number]>) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates },
  };
}

function toLayer(id: string, lineColor: string) {
  return {
    id,
    type: "line" as const,
    source: id,
    paint: { "line-color": lineColor, "line-width": 3, "line-opacity": 0.8 },
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
  };
}

/**
 * Renders per-entity history trails as GeoJSON LineString sources/layers.
 * Unlike markers, sources/layers are wiped by every map.setStyle() (theme
 * swap) — each entity's most recent trail is registered with StyleReattach
 * so it gets replayed on "style.load" instead of silently disappearing.
 */
export class HistoryRenderService {
  private readonly active = new Set<string>();

  constructor(
    private readonly map: MapSourceLike,
    private readonly reattach: StyleReattach,
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

  private _upsert(history: EntityHistory): void {
    const id = sourceId(history.entityId);
    const geojson = toGeoJson(history.coordinates);

    const existingSource = this.map.getSource(id);
    if (existingSource) {
      existingSource.setData(geojson);
    } else {
      this.map.addSource(id, { type: "geojson", data: geojson });
      this.map.addLayer(toLayer(id, history.lineColor));
      this.active.add(history.entityId);
    }

    // Re-registering on every update keeps the replayed data current — a
    // later style.load replays whatever was most recently upserted here.
    this.reattach.register(id, (map) => {
      const m = map as unknown as MapSourceLike;
      if (m.getSource(id)) return;
      m.addSource(id, { type: "geojson", data: geojson });
      m.addLayer(toLayer(id, history.lineColor));
    });
  }

  private _remove(entityId: string): void {
    const id = sourceId(entityId);
    this.reattach.unregister(id);
    this.active.delete(entityId);
    if (this.map.getSource(id)) {
      this.map.removeLayer(id);
      this.map.removeSource(id);
    }
  }
}
