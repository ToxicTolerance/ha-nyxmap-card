import type { EntityConfig } from "../../configs/EntityConfig";
import type { FocusFollow, MapConfig } from "../../configs/MapConfig";
import type { HomeAssistant } from "../../types/home-assistant";
import {
  boundsContains,
  boundsFromLngLatBounds,
  boundsFromPoints,
  padBounds,
  type BoundsLike,
  type MapBoundsLike,
} from "../../util/geo";

// Matches upstream's LatLngBounds.pad(0.1) before fitBounds().
const FIT_BOUNDS_PAD = 0.1;

/** Camera zoom used when the bounds to fit are a single point — mirrors
 * MapConfig's own `zoom` default so a caller that doesn't pass one lands
 * where an unconfigured card would. See _fit(). */
const DEFAULT_POINT_ZOOM = 12;

/** The subset of maplibregl.Map InitialViewRenderService needs. `getBounds()`
 * returns MapLibre's *accessor-style* bounds (a `LngLatBounds`), not a plain
 * west/east/south/north box — declaring the latter here is what let the card
 * hand over a real Map behind an `as unknown as` cast while
 * `boundsContains()` compared numbers against `undefined`. See
 * MapSeamConformance.ts for the compile-time guard against that drifting
 * again. */
export interface MapViewLike {
  jumpTo(options: { center: [number, number]; zoom: number }): unknown;
  fitBounds(bounds: [[number, number], [number, number]]): unknown;
  getBounds(): MapBoundsLike;
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

function boundsEqual(a: BoundsLike, b: BoundsLike): boolean {
  return a.west === b.west && a.east === b.east && a.south === b.south && a.north === b.north;
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
  /** The (unpadded) bounds of the most recent fit this service performed —
   * see updateFit()'s "refocus" guard. */
  private _lastFitted?: BoundsLike;

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
  fitAllEntities(
    map: MapViewLike,
    entities: EntityConfig[],
    hass: HomeAssistant,
    pointZoom: number = DEFAULT_POINT_ZOOM,
  ): void {
    const bounds = this._boundsOf(entities, hass);
    if (!bounds) return;
    this._fit(map, bounds, pointZoom);
  }

  /** Ongoing auto-fit, called on every entity update. focus_follow: "none"
   * (default) does nothing; "refocus" re-fits to all entities whenever they
   * have actually moved; "contains" only re-fits once an entity has left the
   * current view. */
  updateFit(
    map: MapViewLike,
    entities: EntityConfig[],
    hass: HomeAssistant,
    focusFollow: FocusFollow,
    pointZoom: number = DEFAULT_POINT_ZOOM,
  ): void {
    if (focusFollow === "none") return;
    const bounds = this._boundsOf(entities, hass);
    if (!bounds) return;
    const padded = padBounds(bounds, FIT_BOUNDS_PAD);
    if (focusFollow === "contains" && boundsContains(boundsFromLngLatBounds(map.getBounds()), padded)) return;
    // "refocus" is driven by the card's updated() hook, whose gate is
    // `changed.has("hass")` — and Home Assistant hands out a brand-new hass
    // object on every state change *anywhere in the instance*, many times a
    // second on a typical install. Re-fitting unconditionally therefore pins
    // the camera: the user's pan/zoom gesture is undone milliseconds later by
    // a fit triggered by some unrelated sensor. Only re-fit when the entities
    // we track have actually moved since the last fit we performed.
    if (focusFollow === "refocus" && this._lastFitted && boundsEqual(this._lastFitted, bounds)) return;
    this._fit(map, bounds, pointZoom);
  }

  /** Pads and applies `bounds` to the camera, recording it so updateFit()'s
   * "refocus" guard can tell a genuine move from a no-op re-render. */
  private _fit(map: MapViewLike, bounds: BoundsLike, pointZoom: number): void {
    this._lastFitted = bounds;
    const padded = padBounds(bounds, FIT_BOUNDS_PAD);
    // padBounds scales by the box's own width/height, so a single entity (or
    // several at an identical position) stays a zero-area box no matter the
    // pad factor. fitBounds() on that computes an infinite scale factor and
    // clamps to the map's maxZoom, slamming the camera to building level —
    // which is exactly what the most common possible config (one entity, no
    // x/y/focus_entity — see buildStubConfig) produces. Center on the point
    // at the configured zoom instead.
    if (padded.east === padded.west && padded.north === padded.south) {
      map.jumpTo({ center: [bounds.west, bounds.south], zoom: pointZoom });
      return;
    }
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
