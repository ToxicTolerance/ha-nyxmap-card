import type maplibregl from "maplibre-gl";
import type { EntityConfig } from "../../configs/EntityConfig";
import { buildMarkerElement } from "../../maplibre/MarkerFactory";
import type { HomeAssistant } from "../../types/home-assistant";

export type EntityTapHandler = (entityId: string) => void;

/** The subset of a maplibregl.Marker instance EntitiesRenderService needs. */
export interface MarkerLike {
  setLngLat(lngLat: [number, number]): this;
  addTo(map: unknown): this;
  remove(): this;
}

/** The subset of a maplibregl.LngLatBounds instance EntitiesRenderService needs. */
export interface LngLatBoundsLike {
  extend(lngLat: [number, number]): this;
}

/** The subset of the maplibre-gl module EntitiesRenderService needs —
 * narrowed so tests can inject a fake Marker/LngLatBounds implementation
 * instead of requiring a real WebGL context. */
export interface MapLibreGlLike {
  Marker: new (options: { element: HTMLElement }) => MarkerLike;
  LngLatBounds: new () => LngLatBoundsLike;
}

/** Creates/updates/removes HTML Markers for configured entities. Markers
 * live outside the MapLibre style, so — unlike sources/layers — nothing here
 * needs to be registered with StyleReattach; they survive setStyle() calls
 * for free. */
export class EntitiesRenderService {
  private readonly markers = new Map<string, MarkerLike>();
  /** Entity ids whose marker is currently detached from the map because
   * ClusterRenderService considers them absorbed into a cluster bubble —
   * distinct from an entity dropped from config entirely (which deletes the
   * marker outright): a detached marker is kept around so it can be
   * reattached without rebuilding its DOM once it's no longer clustered. */
  private readonly detached = new Set<string>();

  constructor(
    private readonly map: maplibregl.Map,
    private readonly gl: MapLibreGlLike,
    private readonly onTap: EntityTapHandler,
  ) {}

  /** Creates/moves a marker per entity with a resolvable position, detaching
   * (not removing) any entity id present in hiddenIds — e.g. absorbed into a
   * cluster bubble — and reattaching it once it's no longer hidden. Returns
   * bounds covering all positioned entities, or null if none were positioned. */
  update(entities: EntityConfig[], hass: HomeAssistant, hiddenIds?: ReadonlySet<string>): LngLatBoundsLike | null {
    const seen = new Set<string>();
    const bounds = new this.gl.LngLatBounds();
    let any = false;

    for (const ent of entities) {
      // geojson: {hide_marker: true} suppresses the entity's own marker so
      // only its rendered GeoJSON shape shows — mirrors upstream ha-map-card.
      if (ent.geojson?.hideMarker) continue;

      const st = hass.states[ent.id];
      const lng = ent.fixedX ?? st?.attributes?.longitude;
      const lat = ent.fixedY ?? st?.attributes?.latitude;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      seen.add(ent.id);
      any = true;
      const lngLat: [number, number] = [lng as number, lat as number];

      let marker = this.markers.get(ent.id);
      if (!marker) {
        const el = buildMarkerElement(ent, st);
        el.addEventListener("click", () => this.onTap(ent.id));
        marker = new this.gl.Marker({ element: el }).setLngLat(lngLat).addTo(this.map);
        this.markers.set(ent.id, marker);
      } else {
        marker.setLngLat(lngLat);
      }
      bounds.extend(lngLat);

      const shouldHide = hiddenIds?.has(ent.id) ?? false;
      if (shouldHide && !this.detached.has(ent.id)) {
        marker.remove();
        this.detached.add(ent.id);
      } else if (!shouldHide && this.detached.has(ent.id)) {
        marker.addTo(this.map);
        this.detached.delete(ent.id);
      }
    }

    // Entities dropped from config (or now unresolvable) lose their marker.
    for (const id of this.markers.keys()) {
      if (!seen.has(id)) this.remove(id);
    }

    return any ? bounds : null;
  }

  remove(entityId: string): void {
    this.markers.get(entityId)?.remove();
    this.markers.delete(entityId);
    this.detached.delete(entityId);
  }

  removeAll(): void {
    for (const id of [...this.markers.keys()]) this.remove(id);
  }

  has(entityId: string): boolean {
    return this.markers.has(entityId);
  }
}
