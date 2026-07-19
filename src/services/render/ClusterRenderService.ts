import type { EntityConfig } from "../../configs/EntityConfig";
import type { StyleReattach } from "../../maplibre/StyleReattach";
import type { HomeAssistant } from "../../types/home-assistant";
import type { MapSourceLike } from "./HistoryRenderService";
import type { LayerRegistry } from "./LayerRegistry";

const SOURCE_ID = "entity-clusters";
const CIRCLE_LAYER_ID = "entity-clusters-circle";
const COUNT_LAYER_ID = "entity-clusters-count";
// Standard MapLibre/Mapbox clustering example defaults — not tuned to this
// card specifically; see CLAUDE.md backlog note on cluster_markers for why
// there's no config knob for these yet.
const CLUSTER_RADIUS = 50;
const CLUSTER_MAX_ZOOM = 14;

export interface ClusterFeature {
  properties?: { entityId?: string; cluster_id?: number; point_count?: number };
  geometry: { coordinates: [number, number] };
}

export interface ClusterGeoJSONSource {
  setData(data: unknown): void;
  getClusterExpansionZoom(clusterId: number): Promise<number>;
}

/** The subset of maplibregl.Map ClusterRenderService needs beyond
 * MapSourceLike: querying which features MapLibre currently considers
 * clustered, a layer-scoped click handler for click-to-expand, and easeTo to
 * animate into an expanded cluster. */
export interface ClusterMapLike extends MapSourceLike {
  getSource(id: string): ClusterGeoJSONSource | undefined;
  querySourceFeatures(sourceId: string, options?: { filter?: unknown[] }): ClusterFeature[];
  easeTo(options: { center: [number, number]; zoom: number }): unknown;
  on(event: string, handler: (e: unknown) => void): unknown;
  on(event: string, layerId: string, handler: (e: { features?: ClusterFeature[] }) => void): unknown;
}

function toGeoJson(points: Array<{ entityId: string; lngLat: [number, number] }>) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((p) => ({
      type: "Feature" as const,
      properties: { entityId: p.entityId },
      geometry: { type: "Point" as const, coordinates: p.lngLat },
    })),
  };
}

function toSource(data: unknown) {
  return { type: "geojson" as const, data, cluster: true, clusterRadius: CLUSTER_RADIUS, clusterMaxZoom: CLUSTER_MAX_ZOOM };
}

function toLayers(visible: boolean) {
  const visibility = visible ? ("visible" as const) : ("none" as const);
  return [
    {
      id: CIRCLE_LAYER_ID,
      type: "circle" as const,
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#51bbd6", 10, "#f1c40f", 50, "#e74c3c"],
        "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
      layout: { visibility },
    },
    {
      id: COUNT_LAYER_ID,
      type: "symbol" as const,
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, visibility },
      paint: { "text-color": "#ffffff" },
    },
  ];
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Renders a `cluster: true` GeoJSON source of entity positions, drawing only
 * the count-bubble circle/symbol layers (CLAUDE.md's `cluster_markers`
 * backlog item) — individual entities keep their existing HTML-marker look
 * (EntitiesRenderService/MarkerFactory) at all times. The two are reconciled
 * by recomputing, on every camera settle, which entity ids MapLibre currently
 * considers absorbed into a bubble (querySourceFeatures for the *unclustered*
 * leaves, diffed against every entity fed in) and notifying the card via
 * `onVisibilityChange` so it can detach/reattach the corresponding markers.
 *
 * Like history trails/circles, the source/layers are wiped by every
 * map.setStyle() (theme swap), so the most recent data is registered with
 * StyleReattach for replay. The zoomend/moveend/data/click listeners are
 * attached once to the live Map instance (not the style), so they survive
 * setStyle() on their own, same as GeoJsonRenderService's click handlers.
 *
 * update() deliberately does *not* trigger a recompute itself:
 * querySourceFeatures() only reflects already-rendered tiles, which right
 * after addSource()/setData() is typically none — an immediate recompute
 * would spuriously report every entity as clustered until the real
 * "data"(isSourceLoaded)/zoomend/moveend event fires shortly after.
 */
export class ClusterRenderService {
  private _entityIds = new Set<string>();
  private _hidden = new Set<string>();
  private _enabled = true;
  private _built = false;

  constructor(
    private readonly map: ClusterMapLike,
    private readonly reattach: StyleReattach,
    private readonly layerRegistry: LayerRegistry,
    private readonly onVisibilityChange: () => void,
  ) {
    this.map.on("zoomend", () => this._recompute());
    this.map.on("moveend", () => this._recompute());
    this.map.on("data", (e) => {
      const ev = e as { sourceId?: string; isSourceLoaded?: boolean };
      if (ev.sourceId === SOURCE_ID && ev.isSourceLoaded) this._recompute();
    });
    this.map.on("click", CIRCLE_LAYER_ID, (e) => this._onClusterClick(e));
  }

  update(entities: EntityConfig[], hass: HomeAssistant): void {
    const points: Array<{ entityId: string; lngLat: [number, number] }> = [];
    for (const ent of entities) {
      if (ent.geojson?.hideMarker) continue;
      const st = hass.states[ent.id];
      const lng = ent.fixedX ?? st?.attributes?.longitude;
      const lat = ent.fixedY ?? st?.attributes?.latitude;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      points.push({ entityId: ent.id, lngLat: [lng as number, lat as number] });
    }
    this._entityIds = new Set(points.map((p) => p.entityId));
    const geojson = toGeoJson(points);
    const isVisible = () => this._enabled;

    const existingSource = this.map.getSource(SOURCE_ID);
    if (existingSource) {
      existingSource.setData(geojson);
    } else {
      this.map.addSource(SOURCE_ID, toSource(geojson));
      for (const layer of toLayers(isVisible())) this.map.addLayer(layer);
      this._built = true;
    }

    // Re-registering on every update keeps the replayed data current — a
    // later style.load replays whatever was most recently upserted here.
    this.reattach.register(SOURCE_ID, (map) => {
      const m = map as unknown as ClusterMapLike;
      if (m.getSource(SOURCE_ID)) return;
      m.addSource(SOURCE_ID, toSource(geojson));
      for (const layer of toLayers(isVisible())) m.addLayer(layer);
    });

    this.layerRegistry.registerOverlay(SOURCE_ID, {
      label: "Clusters",
      group: "cluster",
      setVisible: (map, visible) => {
        this._enabled = visible;
        const m = map as ClusterMapLike;
        const layout = visible ? "visible" : "none";
        m.setLayoutProperty(CIRCLE_LAYER_ID, "visibility", layout);
        m.setLayoutProperty(COUNT_LAYER_ID, "visibility", layout);
        this._recompute();
      },
    });
  }

  /** Entity ids currently absorbed into a cluster bubble and whose HTML
   * marker should therefore be detached; empty whenever the "Clusters"
   * overlay itself is toggled off. */
  getHiddenEntityIds(): ReadonlySet<string> {
    return this._enabled ? this._hidden : new Set();
  }

  removeAll(): void {
    this.reattach.unregister(SOURCE_ID);
    this.layerRegistry.unregister(SOURCE_ID);
    this._entityIds = new Set();
    this._hidden = new Set();
    if (this.map.getSource(SOURCE_ID)) {
      this.map.removeLayer(COUNT_LAYER_ID);
      this.map.removeLayer(CIRCLE_LAYER_ID);
      this.map.removeSource(SOURCE_ID);
    }
    this._built = false;
  }

  private _recompute(): void {
    if (!this._built || !this._enabled) {
      if (this._hidden.size > 0) {
        this._hidden = new Set();
        this.onVisibilityChange();
      }
      return;
    }
    const visible = new Set(
      this.map
        .querySourceFeatures(SOURCE_ID, { filter: ["!", ["has", "point_count"]] })
        .map((f) => f.properties?.entityId)
        .filter((id): id is string => Boolean(id)),
    );
    const hidden = new Set([...this._entityIds].filter((id) => !visible.has(id)));
    if (!setsEqual(hidden, this._hidden)) {
      this._hidden = hidden;
      this.onVisibilityChange();
    }
  }

  private _onClusterClick(e: { features?: ClusterFeature[] }): void {
    const feature = e.features?.[0];
    const clusterId = feature?.properties?.cluster_id;
    const source = this.map.getSource(SOURCE_ID);
    if (clusterId == null || !source || !feature) return;
    void source.getClusterExpansionZoom(clusterId).then((zoom) => {
      this.map.easeTo({ center: feature.geometry.coordinates, zoom });
    });
  }
}
