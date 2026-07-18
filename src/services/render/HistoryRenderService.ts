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

function toLayer(id: string, lineColor: string, visible: boolean) {
  return {
    id,
    type: "line" as const,
    source: id,
    paint: { "line-color": lineColor, "line-width": 3, "line-opacity": 0.8 },
    layout: {
      "line-cap": "round" as const,
      "line-join": "round" as const,
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
export class HistoryRenderService {
  private readonly active = new Set<string>();
  private readonly visibility = new Map<string, boolean>();

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

  private _upsert(history: EntityHistory): void {
    const id = sourceId(history.entityId);
    const geojson = toGeoJson(history.coordinates);
    const isVisible = () => this.visibility.get(id) ?? true;

    const existingSource = this.map.getSource(id);
    if (existingSource) {
      existingSource.setData(geojson);
    } else {
      this.map.addSource(id, { type: "geojson", data: geojson });
      this.map.addLayer(toLayer(id, history.lineColor, isVisible()));
      this.active.add(history.entityId);
    }

    // Re-registering on every update keeps the replayed data current — a
    // later style.load replays whatever was most recently upserted here.
    this.reattach.register(id, (map) => {
      const m = map as unknown as MapSourceLike;
      if (m.getSource(id)) return;
      m.addSource(id, { type: "geojson", data: geojson });
      m.addLayer(toLayer(id, history.lineColor, isVisible()));
    });

    this.layerRegistry.registerOverlay(id, {
      label: `History: ${history.entityId}`,
      group: "history",
      setVisible: (map, visible) => {
        this.visibility.set(id, visible);
        (map as MapSourceLike).setLayoutProperty(id, "visibility", visible ? "visible" : "none");
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
      this.map.removeLayer(id);
      this.map.removeSource(id);
    }
  }
}
