import type { EntityConfig } from "../../configs/EntityConfig";
import type { FocusFollow, MapConfig } from "../../configs/MapConfig";
import type { HomeAssistant } from "../../types/home-assistant";
import { boundsContains, boundsFromPoints, padBounds, type BoundsLike } from "../../util/geo";

// Matches upstream's LatLngBounds.pad(0.1) before fitBounds().
const FIT_BOUNDS_PAD = 0.1;

/** The subset of maplibregl.Map InitialViewRenderService needs. */
export interface MapViewLike {
  jumpTo(options: { center: [number, number]; zoom: number }): unknown;
  fitBounds(bounds: [[number, number], [number, number]]): unknown;
  getBounds(): BoundsLike;
}

function entityLatLng(ent: EntityConfig, hass: HomeAssistant): [number, number] | null {
  const st = hass.states[ent.id];
  const lng = ent.fixedX ?? st?.attributes?.longitude;
  const lat = ent.fixedY ?? st?.attributes?.latitude;
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng as number, lat as number] : null;
}

function boundsToTuple(b: BoundsLike): [[number, number], [number, number]] {
  return [
    [b.west, b.south],
    [b.east, b.north],
  ];
}

/**
 * Mirrors upstream's InitialViewRenderService (one-time initial centering:
 * explicit x/y > focus_entity > fall back to fitting all entities) plus
 * EntitiesRenderService.updateInitialView (ongoing auto-fit across all
 * entities on every update, gated by focus_follow). Upstream splits these
 * across two classes because its EntitiesRenderService also owns marker
 * rendering; ours doesn't, so both live here.
 */
export class InitialViewRenderService {
  /** Explicit x/y takes precedence over focus_entity; null means neither is
   * resolvable and the caller should fall back to fitAllEntities(). */
  getInitialCenter(config: MapConfig, hass?: HomeAssistant): [number, number] | null {
    if (Number.isFinite(config.x) && Number.isFinite(config.y)) {
      return [config.x as number, config.y as number];
    }
    if (config.focusEntity && hass) {
      const st = hass.states[config.focusEntity];
      const lng = st?.attributes?.longitude;
      const lat = st?.attributes?.latitude;
      if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng as number, lat as number];
    }
    return null;
  }

  /** Unconditional fit over all focus_on_fit entities — used once for the
   * initial view when neither explicit x/y nor a resolvable focus_entity is
   * configured. */
  fitAllEntities(map: MapViewLike, entities: EntityConfig[], hass: HomeAssistant): void {
    const bounds = this._boundsOf(entities, hass);
    if (!bounds) return;
    map.fitBounds(boundsToTuple(padBounds(bounds, FIT_BOUNDS_PAD)));
  }

  /** Ongoing auto-fit, called on every entity update. focus_follow: "none"
   * (default) does nothing; "refocus" always re-fits to all entities;
   * "contains" only re-fits once an entity has left the current view. */
  updateFit(
    map: MapViewLike,
    entities: EntityConfig[],
    hass: HomeAssistant,
    focusFollow: FocusFollow,
  ): void {
    if (focusFollow === "none") return;
    const bounds = this._boundsOf(entities, hass);
    if (!bounds) return;
    const padded = padBounds(bounds, FIT_BOUNDS_PAD);
    if (focusFollow === "contains" && boundsContains(map.getBounds(), padded)) return;
    map.fitBounds(boundsToTuple(padded));
  }

  private _boundsOf(entities: EntityConfig[], hass: HomeAssistant): BoundsLike | null {
    const points = entities
      .filter((e) => e.focusOnFit)
      .map((e) => entityLatLng(e, hass))
      .filter((p): p is [number, number] => p !== null);
    return boundsFromPoints(points);
  }
}
