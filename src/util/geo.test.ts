import { describe, expect, it } from "vitest";
import { boundsContains, boundsFromLngLatBounds, boundsFromPoints, padBounds } from "./geo";

describe("boundsFromLngLatBounds", () => {
  it("reads MapLibre's accessor methods rather than (non-existent) properties", () => {
    // A real maplibregl.LngLatBounds carries only _ne/_sw plus these getters —
    // treating it as a plain {west,east,south,north} box yields `undefined`
    // everywhere, which is what silently broke focus_follow: "contains".
    const lngLatBounds = {
      _sw: { lng: -1, lat: -2 },
      _ne: { lng: 3, lat: 4 },
      getWest: () => -1,
      getEast: () => 3,
      getSouth: () => -2,
      getNorth: () => 4,
    };
    expect(boundsFromLngLatBounds(lngLatBounds)).toEqual({ west: -1, east: 3, south: -2, north: 4 });
  });
});

describe("boundsFromPoints", () => {
  it("returns null for an empty list", () => {
    expect(boundsFromPoints([])).toBeNull();
  });

  it("collapses to a point for a single coordinate", () => {
    expect(boundsFromPoints([[1, 2]])).toEqual({ west: 1, east: 1, south: 2, north: 2 });
  });

  it("spans the min/max of multiple points", () => {
    const bounds = boundsFromPoints([
      [1, 5],
      [-3, 2],
      [4, -1],
    ]);
    expect(bounds).toEqual({ west: -3, east: 4, south: -1, north: 5 });
  });
});

describe("padBounds", () => {
  it("expands each side by factor * width/height", () => {
    const bounds = { west: 0, east: 10, south: 0, north: 20 };
    expect(padBounds(bounds, 0.1)).toEqual({ west: -1, east: 11, south: -2, north: 22 });
  });

  it("leaves a zero-size bounds (single point) unchanged", () => {
    const point = { west: 5, east: 5, south: 5, north: 5 };
    expect(padBounds(point, 0.1)).toEqual(point);
  });
});

describe("boundsContains", () => {
  const outer = { west: 0, east: 10, south: 0, north: 10 };

  it("is true when inner is fully within outer", () => {
    expect(boundsContains(outer, { west: 2, east: 8, south: 2, north: 8 })).toBe(true);
  });

  it("is true when inner exactly equals outer (inclusive bounds)", () => {
    expect(boundsContains(outer, outer)).toBe(true);
  });

  it("is false when inner extends past any single edge", () => {
    expect(boundsContains(outer, { west: -1, east: 8, south: 2, north: 8 })).toBe(false);
    expect(boundsContains(outer, { west: 2, east: 11, south: 2, north: 8 })).toBe(false);
    expect(boundsContains(outer, { west: 2, east: 8, south: -1, north: 8 })).toBe(false);
    expect(boundsContains(outer, { west: 2, east: 8, south: 2, north: 11 })).toBe(false);
  });
});
