/**
 * Pure screen-space geometry for marker clustering: where a bubble sits, and
 * how far a click into it should zoom. DOM-free and map-free by design, so it
 * tests under vitest's default `node` environment — same reasoning as
 * `LayerSwitcherLayout` and `EntityListReconcile`.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

/** A clustered entity as the geometry cares about it: where its marker is on
 * screen, and how wide that marker is. */
export interface ClusterMember {
  xy: ScreenPoint;
  size: number;
}

export interface Circle extends ScreenPoint {
  r: number;
}

/** How much clearance past bare tangency counts as "visibly separated" when
 * deciding a click-to-expand zoom. */
const SEPARATION_MARGIN = 1.3;
/** A click must always visibly do something, even when the group already fills
 * the viewport and the fit constraint alone would say "don't zoom at all". */
const MIN_EXPANSION_DELTA = 0.5;

function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// A hair of slack on the containment test: the circle through three points
// reports those points at exactly r, and binary floating point routinely lands
// them a few ulps outside, which would restart the search forever.
const EPS = 1e-9;

function contains(c: Circle, p: ScreenPoint): boolean {
  return distance(c, p) <= c.r + EPS * Math.max(1, c.r);
}

function circleFromDiameter(a: ScreenPoint, b: ScreenPoint): Circle {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: distance(a, b) / 2 };
}

/** Circumcircle of three points, or null when they are collinear (no finite
 * circumcentre — the caller falls back to the diameter circle). */
function circumcircle(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): Circle | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const aSq = a.x * a.x + a.y * a.y;
  const bSq = b.x * b.x + b.y * b.y;
  const cSq = c.x * c.x + c.y * c.y;
  const x = (aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d;
  const y = (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d;
  const centre = { x, y };
  return { x, y, r: distance(centre, a) };
}

/**
 * Smallest circle enclosing every point — Welzl's algorithm, unrolled into the
 * usual three nested passes.
 *
 * Its **centre** is what a cluster bubble is anchored at: the point whose
 * greatest distance to any member is as small as possible, i.e. genuinely the
 * middle of the group's footprint. The obvious alternative, the arithmetic mean
 * of the member positions, is a centre of *mass*: four entities in a knot plus
 * one a marker-width away drag it onto the knot, leaving the bubble sitting on
 * top of four of its members instead of between all five. Measured in a real
 * browser on exactly that arrangement, the mean landed 23px — most of a bubble
 * diameter — from the middle of the footprint.
 *
 * The other candidate, the midpoint of the bounding box, agrees with this one
 * on that arrangement but is axis-aligned, so it slides relative to the members
 * as the map is rotated (the card ships a compass). This is rotation-invariant.
 *
 * Deliberately **not** randomised, unlike the textbook formulation: the input
 * order is the caller's order, so the same group yields a bit-identical centre
 * on every frame. A shuffle buys an expected-linear bound that a cluster of a
 * handful of markers does not need, and pays for it in a bubble that can jitter
 * between frames on nothing but a different draw of the dice.
 */
export function smallestEnclosingCircle(points: readonly ScreenPoint[]): Circle {
  if (points.length === 0) return { x: 0, y: 0, r: 0 };
  let c: Circle = { x: points[0]!.x, y: points[0]!.y, r: 0 };
  for (let i = 1; i < points.length; i++) {
    const pi = points[i]!;
    if (contains(c, pi)) continue;
    c = { x: pi.x, y: pi.y, r: 0 };
    for (let j = 0; j < i; j++) {
      const pj = points[j]!;
      if (contains(c, pj)) continue;
      c = circleFromDiameter(pi, pj);
      for (let k = 0; k < j; k++) {
        const pk = points[k]!;
        if (contains(c, pk)) continue;
        c = circumcircle(pi, pj, pk) ?? circleFromDiameter(pi, pk);
      }
    }
  }
  return c;
}

/** Screen-space footprint of a group, including the markers themselves — a
 * member's marker extends half a diameter past its own centre, so the visible
 * extent is the centres' bounding box grown by one marker width. */
function footprint(members: readonly ClusterMember[]): { width: number; height: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxSize = 0;
  for (const m of members) {
    minX = Math.min(minX, m.xy.x);
    maxX = Math.max(maxX, m.xy.x);
    minY = Math.min(minY, m.xy.y);
    maxY = Math.max(maxY, m.xy.y);
    maxSize = Math.max(maxSize, m.size);
  }
  return { width: maxX - minX + maxSize, height: maxY - minY + maxSize };
}

/**
 * How many zoom levels a click into a bubble should descend.
 *
 * Two independent ceilings, whichever is lower:
 *
 * - **Separation** — the Web-Mercator identity that the pixel gap between two
 *   fixed positions doubles per zoom level lets us solve, without moving the
 *   camera to test, for the levels needed to pull the tightest colliding pair
 *   apart. There is no point going deeper than that: the group has expanded.
 * - **Fit** — the levels after which the group's own footprint would outgrow
 *   the viewport. Zooming past this throws the cluster's outer members off
 *   screen, which is the opposite of what expanding a cluster is for.
 *
 * The fit ceiling is what stops the pathological case: two entities reporting
 * byte-identical coordinates can never be separated at any zoom, so the
 * separation term is infinite and the old code fell back to a flat +6 levels —
 * measured in a real browser as a jump from z15 to z21, the whole map thrown
 * away to reveal two markers still exactly on top of each other.
 *
 * `maxZoom` should be `cluster_max_zoom`: at or above it clustering is off
 * entirely, so the group is guaranteed to have expanded and further zoom buys
 * nothing. A bubble only exists below that threshold, so the result is always
 * a zoom *in*.
 */
export function computeExpansionZoom(
  members: readonly ClusterMember[],
  currentZoom: number,
  maxZoom: number,
  viewport: { width: number; height: number },
): number {
  let separation = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]!;
      const b = members[j]!;
      const dist = distance(a.xy, b.xy);
      const need = ((a.size + b.size) / 2) * SEPARATION_MARGIN;
      if (dist >= need) continue;
      // Coincident to the last bit: no zoom will ever part them, so let the fit
      // ceiling alone decide how far to go.
      separation = dist < 1e-6 ? Infinity : Math.max(separation, Math.log2(need / dist));
    }
  }

  const { width, height } = footprint(members);
  const fit =
    viewport.width > 0 && viewport.height > 0
      ? Math.max(0, Math.min(Math.log2(viewport.width / width), Math.log2(viewport.height / height)))
      : Infinity;

  const delta = Math.max(MIN_EXPANSION_DELTA, Math.min(separation, fit));
  return Math.min(currentZoom + delta, maxZoom);
}
