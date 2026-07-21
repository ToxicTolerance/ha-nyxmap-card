import type maplibregl from "maplibre-gl";
import type { EntityConfig } from "../../configs/EntityConfig";
import { animateConverge, animateEmerge } from "../../maplibre/MarkerAnimator";
import {
  applyMarkerVisual,
  buildMarkerElement,
  markerVisualKey,
  wrapAnimatedMarker,
} from "../../maplibre/MarkerFactory";
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
/** A tracked marker: the maplibregl.Marker (whose element is the animation
 * wrapper) plus a direct handle to the inner visual node — the wrapper is what
 * addTo/remove mount, the inner node is what carries the click listener and the
 * animation class toggle (see wrapAnimatedMarker / MarkerAnimator). */
interface TrackedMarker {
  marker: MarkerLike;
  inner: HTMLElement;
  /** markerVisualKey() of the config+state the inner element was last drawn
   * from — see the rebuild branch in update(). */
  visualKey: string;
}

export class EntitiesRenderService {
  private readonly markers = new Map<string, TrackedMarker>();
  /** Entity ids whose marker is currently detached from the map because
   * ClusterRenderService considers them absorbed into a cluster bubble —
   * distinct from an entity dropped from config entirely (which deletes the
   * marker outright): a detached marker is kept around so it can be
   * reattached without rebuilding its DOM once it's no longer clustered. */
  private readonly detached = new Set<string>();
  /** Cluster centroid (lng/lat) an entity was absorbed into, remembered at
   * hide time so that when it's later released the marker can emerge FROM that
   * same point — the split half of the spring animation. */
  private readonly absorbedCentroid = new Map<string, [number, number]>();

  constructor(
    private readonly map: maplibregl.Map,
    private readonly gl: MapLibreGlLike,
    private readonly onTap: EntityTapHandler,
  ) {}

  /** Creates/moves a marker per entity with a resolvable position, detaching
   * (not removing) any entity id present in `absorbed` — e.g. pulled into a
   * cluster bubble at that centroid — and reattaching it once it's no longer
   * absorbed. `absorbed` maps each hidden entity id to the lng/lat of the
   * bubble it belongs to, so the marker can spring toward/away from it (see
   * MarkerAnimator). Returns bounds covering all positioned entities, or null
   * if none were positioned. */
  update(
    entities: EntityConfig[],
    hass: HomeAssistant,
    absorbed?: ReadonlyMap<string, [number, number]>,
  ): LngLatBoundsLike | null {
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

      const visualKey = markerVisualKey(ent, st);
      let tracked = this.markers.get(ent.id);
      if (!tracked) {
        const inner = buildMarkerElement(ent, st);
        inner.addEventListener("click", () => this.onTap(ent.id));
        const marker = new this.gl.Marker({ element: wrapAnimatedMarker(inner, ent.zIndexOffset) })
          .setLngLat(lngLat)
          .addTo(this.map);
        tracked = { marker, inner, visualKey };
        this.markers.set(ent.id, tracked);
      } else {
        tracked.marker.setLngLat(lngLat);
        // The marker DOM used to be built exactly once, so a rotated
        // entity_picture token (HA's /api/image_proxy/ URLs expire), a
        // state-templated `icon`, a rename, or a recolour all left the marker
        // frozen at its first-render appearance. Redrawn in place (not
        // replaced) so the click listener and any in-flight MarkerAnimator
        // state on this node survive — see applyMarkerVisual.
        if (tracked.visualKey !== visualKey) {
          applyMarkerVisual(tracked.inner, ent, st);
          // z_index_offset lives on the positioning wrapper, not the visual
          // node (see wrapAnimatedMarker), so applyMarkerVisual can't carry
          // it — without this, a changed z_index_offset only ever took effect
          // on a freshly created marker.
          const wrapper = tracked.inner.parentElement;
          if (wrapper) wrapper.style.zIndex = String(ent.zIndexOffset);
          tracked.visualKey = visualKey;
        }
      }
      bounds.extend(lngLat);

      const { marker, inner } = tracked;
      const centroid = absorbed?.get(ent.id);
      const shouldHide = centroid !== undefined;
      if (shouldHide && !this.detached.has(ent.id)) {
        this.detached.add(ent.id);
        this.absorbedCentroid.set(ent.id, centroid);
        // Converge toward the bubble's centre, then unmount once it completes.
        const [dx, dy] = this._offsetTo(lngLat, centroid);
        animateConverge(inner, dx, dy, () => marker.remove());
      } else if (!shouldHide && this.detached.has(ent.id)) {
        this.detached.delete(ent.id);
        // Emerge from wherever the entity was last absorbed. addTo() is safe
        // even if animateConverge's pending remove() hasn't fired yet —
        // Marker.addTo() calls remove() first (idempotent remount).
        const from = this.absorbedCentroid.get(ent.id) ?? lngLat;
        this.absorbedCentroid.delete(ent.id);
        marker.addTo(this.map);
        const [dx, dy] = this._offsetTo(lngLat, from);
        animateEmerge(inner, dx, dy);
      }
    }

    // Entities dropped from config (or now unresolvable) lose their marker.
    for (const id of this.markers.keys()) {
      if (!seen.has(id)) this.remove(id);
    }

    return any ? bounds : null;
  }

  /** Pixel vector from `from` (a marker's own lng/lat) to `to` (the cluster
   * centroid) at the current camera — the spring's travel offset. */
  private _offsetTo(from: [number, number], to: [number, number]): [number, number] {
    const a = this.map.project(from);
    const b = this.map.project(to);
    return [b.x - a.x, b.y - a.y];
  }

  remove(entityId: string): void {
    this.markers.get(entityId)?.marker.remove();
    this.markers.delete(entityId);
    this.detached.delete(entityId);
    this.absorbedCentroid.delete(entityId);
  }

  removeAll(): void {
    for (const id of [...this.markers.keys()]) this.remove(id);
  }

  has(entityId: string): boolean {
    return this.markers.has(entityId);
  }
}
