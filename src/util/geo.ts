import circle from "@turf/circle";

export interface BoundsLike {
  west: number;
  east: number;
  south: number;
  north: number;
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
