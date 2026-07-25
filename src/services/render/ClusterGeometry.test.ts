import { describe, expect, it } from "vitest";
import { type ClusterMember, computeExpansionZoom, smallestEnclosingCircle } from "./ClusterGeometry";

const VIEWPORT = { width: 800, height: 400 };

function member(x: number, y: number, size = 48): ClusterMember {
  return { xy: { x, y }, size };
}

describe("smallestEnclosingCircle", () => {
  it("returns a degenerate circle for no points", () => {
    expect(smallestEnclosingCircle([])).toEqual({ x: 0, y: 0, r: 0 });
  });

  it("returns the point itself for one point", () => {
    expect(smallestEnclosingCircle([{ x: 3, y: 7 }])).toEqual({ x: 3, y: 7, r: 0 });
  });

  it("uses the pair as a diameter for two points", () => {
    const c = smallestEnclosingCircle([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(c.x).toBeCloseTo(5);
    expect(c.y).toBeCloseTo(0);
    expect(c.r).toBeCloseTo(5);
  });

  it("is not dragged off centre by how densely points bunch up", () => {
    // Ten points piled at the origin plus one at x=100. A mean would sit at
    // x≈9; the middle of the footprint is x=50.
    const points = [...Array<null>(10).fill(null).map(() => ({ x: 0, y: 0 })), { x: 100, y: 0 }];
    const c = smallestEnclosingCircle(points);
    expect(c.x).toBeCloseTo(50);
    expect(c.r).toBeCloseTo(50);
  });

  it("encloses every point, with the extremes exactly on the rim", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 40 },
      { x: -20, y: 10 },
      { x: 5, y: -25 },
      { x: 12, y: 3 },
    ];
    const c = smallestEnclosingCircle(points);
    for (const p of points) {
      expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeLessThanOrEqual(c.r + 1e-6);
    }
    // Tight: at least one point sits on the rim.
    const maxDist = Math.max(...points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
    expect(maxDist).toBeCloseTo(c.r, 6);
  });

  it("handles collinear points, where three-point circumcircles do not exist", () => {
    const c = smallestEnclosingCircle([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(c.x).toBeCloseTo(5);
    expect(c.y).toBeCloseTo(0);
    expect(c.r).toBeCloseTo(5);
  });

  it("is rotation-invariant, which a bounding-box midpoint is not", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
    ];
    const theta = Math.PI / 6;
    const rot = (p: { x: number; y: number }) => ({
      x: p.x * Math.cos(theta) - p.y * Math.sin(theta),
      y: p.x * Math.sin(theta) + p.y * Math.cos(theta),
    });
    const a = smallestEnclosingCircle(points);
    const b = smallestEnclosingCircle(points.map(rot));
    const aRotated = rot(a);
    expect(b.x).toBeCloseTo(aRotated.x, 6);
    expect(b.y).toBeCloseTo(aRotated.y, 6);
    expect(b.r).toBeCloseTo(a.r, 6);
  });

  it("is deterministic: the same input yields a bit-identical circle", () => {
    const points = [
      { x: 1, y: 2 },
      { x: 51, y: 9 },
      { x: 20, y: 44 },
      { x: 33, y: -8 },
    ];
    expect(smallestEnclosingCircle(points)).toEqual(smallestEnclosingCircle(points));
  });
});

describe("computeExpansionZoom", () => {
  it("zooms only as far as it takes to separate the tightest pair", () => {
    // 40px apart, needing 48*1.3 = 62.4 → log2(62.4/40) ≈ 0.64 levels. The old
    // behaviour floored every expansion at a full level.
    const zoom = computeExpansionZoom([member(0, 0), member(40, 0)], 10, 14, VIEWPORT);
    expect(zoom).toBeCloseTo(10 + Math.log2(62.4 / 40), 6);
  });

  it("caps at maxZoom (cluster_max_zoom), not the map's own ceiling", () => {
    expect(computeExpansionZoom([member(0, 0), member(1, 0)], 13, 14, VIEWPORT)).toBe(14);
  });

  it("does not chase co-located entities to full zoom", () => {
    // Identical coordinates: no zoom separates them, so the separation term is
    // infinite. Only the fit ceiling and maxZoom decide, and the result must
    // stay a modest step rather than the old flat +6 levels.
    const zoom = computeExpansionZoom([member(5, 5), member(5, 5)], 10, 22, VIEWPORT);
    expect(zoom).toBeGreaterThan(10);
    expect(zoom).toBeLessThan(14);
  });

  it("stops before the group's own footprint outgrows the viewport", () => {
    // 300px apart in a 400px-tall viewport: separating them wants a full level
    // (600px), which would push both members off screen.
    const tall = { width: 800, height: 400 };
    const zoom = computeExpansionZoom([member(0, 0), member(0, 300)], 10, 22, tall);
    // Footprint is 300 + 48 = 348px; 400/348 → ~0.2 levels, under the floor.
    expect(zoom).toBeCloseTo(10.5, 6);
  });

  it("always zooms in a little, even when the group already fills the viewport", () => {
    const cramped = { width: 100, height: 60 };
    const zoom = computeExpansionZoom([member(0, 0), member(0, 200)], 10, 22, cramped);
    expect(zoom).toBe(10.5);
  });

  it("falls back to the separation ceiling when the viewport is unmeasurable", () => {
    // A card that has not been laid out yet reports 0x0; the fit term must not
    // become -Infinity and swallow the zoom.
    const zoom = computeExpansionZoom([member(0, 0), member(20, 0)], 10, 22, { width: 0, height: 0 });
    expect(zoom).toBeCloseTo(10 + Math.log2(62.4 / 20), 6);
  });

  it("ignores pairs that are already comfortably apart", () => {
    // Two clusters' worth of members where one pair is far beyond touching:
    // that pair contributes nothing, so the floor governs.
    expect(computeExpansionZoom([member(0, 0), member(500, 0)], 10, 22, VIEWPORT)).toBe(10.5);
  });
});
