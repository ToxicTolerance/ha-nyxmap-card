import circle from "@turf/circle";

/** A plain west/east/south/north box — this project's own bounds currency.
 * Deliberately *not* the shape MapLibre hands back from `Map.getBounds()`:
 * a real `maplibregl.LngLatBounds` exposes `_ne`/`_sw` plus accessor methods
 * (`getWest()` and friends) and has no such properties at all. See
 * `MapBoundsLike` / `boundsFromLngLatBounds()` for the adapter. */
export interface BoundsLike {
  west: number;
  east: number;
  south: number;
  north: number;
}

/** The accessor surface `maplibregl.LngLatBounds` actually exposes. Kept
 * separate from `BoundsLike` because the two are *not* interchangeable —
 * reading `.west` off a real LngLatBounds yields `undefined`, which silently
 * turns every numeric comparison in `boundsContains()` into `false`. That was
 * a live defect: `focus_follow: "contains"` never short-circuited, so the
 * camera re-fitted on every `hass` object (many times a second). */
export interface MapBoundsLike {
  getWest(): number;
  getEast(): number;
  getSouth(): number;
  getNorth(): number;
}

/** Adapts MapLibre's accessor-style bounds into this project's plain box. */
export function boundsFromLngLatBounds(b: MapBoundsLike): BoundsLike {
  return { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
}

/** Bounding box over a set of [lng, lat] points, or null if there are none. */
export function boundsFromPoints(points: Array<[number, number]>): BoundsLike | null {
  if (points.length === 0) return null;
  let west = points[0]![0];
  let east = points[0]![0];
  let south = points[0]![1];
  let north = points[0]![1];
  for (const [lng, lat] of points) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, east, south, north };
}

/** Expands bounds outward by `factor` × width/height on each side — mirrors
 * Leaflet's LatLngBounds.pad(), which upstream uses before fitBounds() so a
 * single point or tight cluster doesn't end up flush against the viewport. */
export function padBounds(bounds: BoundsLike, factor: number): BoundsLike {
  const width = bounds.east - bounds.west;
  const height = bounds.north - bounds.south;
  return {
    west: bounds.west - width * factor,
    east: bounds.east + width * factor,
    south: bounds.south - height * factor,
    north: bounds.north + height * factor,
  };
}

/** True if `outer` fully contains `inner`. MapLibre's own
 * `LngLatBounds.contains()` only tests a single point (unlike Leaflet's,
 * which is overloaded to accept another bounds) — this fills that gap for
 * focus_follow: "contains". */
export function boundsContains(outer: BoundsLike, inner: BoundsLike): boolean {
  return (
    inner.west >= outer.west &&
    inner.east <= outer.east &&
    inner.south >= outer.south &&
    inner.north <= outer.north
  );
}

/** Geodesic circle polygon (ring coordinates, GeoJSON Polygon shape) around
 * `center` ([lng, lat]) with `radiusMeters`. Uses @turf/circle rather than a
 * flat-degrees approximation so circles stay round at high latitudes. */
export function circlePolygonCoordinates(
  center: [number, number],
  radiusMeters: number,
  steps = 64,
): number[][][] {
  return circle(center, radiusMeters, { steps, units: "meters" }).geometry.coordinates;
}
