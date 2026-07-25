import type { EntityConfig } from "../../configs/EntityConfig";
import { animateConverge, animateEmerge } from "../../maplibre/MarkerAnimator";
import { applyClusterBubbleVisual, buildClusterBubbleElement, wrapAnimatedMarker } from "../../maplibre/MarkerFactory";
import type { HomeAssistant } from "../../types/home-assistant";
import { type ClusterMember as Member, computeExpansionZoom, smallestEnclosingCircle } from "./ClusterGeometry";
import type { LayerRegistry } from "./LayerRegistry";
import { CLUSTER_OVERLAY_ID as OVERLAY_ID } from "./OverlayIds";
import type { MapLibreGlLike, MarkerLike } from "./EntitiesRenderService";
const DEFAULT_MAX_ZOOM = 14;
// Hysteresis multipliers on the per-pair touch distance: a pair must be
// comfortably *within* touch distance to newly merge, and comfortably *outside*
// it to split — the ~20% dead zone between them stops a pair sitting near the
// boundary from flipping every frame during a slow drag. See class doc.
const MERGE_FACTOR = 0.95;
const SPLIT_FACTOR = 1.15;
/**
 * Cap on how far a single group may sprawl, as a multiple of its largest
 * member's marker diameter — the diagonal of the group's screen-space bounding
 * box must stay within it for a merge to be accepted.
 *
 * Grouping is single-linkage (A joins B, B joins C ⇒ one group), and unbounded
 * single-linkage *chains*: a row of markers each overlapping only its immediate
 * neighbour collapses into one bubble spanning the whole viewport, anchored at a
 * centroid that sits on top of a middle member rather than "between" anything.
 * That is what makes a bubble read as offset from the entities it stands for.
 * With the cap, the chain breaks into several bubbles that each genuinely sit
 * among their own members. 3 × a default 48px marker ≈ 144px, comfortably wider
 * than any real overlapping blob but well short of a viewport.
 */
const MAX_GROUP_SPREAD_FACTOR = 3;

export interface ClusterOptions {
  /** Zoom level at and above which clustering stops entirely, regardless of
   * how close entities render — collision detection is skipped above this. */
  maxZoom?: number;
}

/** Screen-space projection surface the touching-based grouping needs, plus the
 * camera-event hookup and easeTo for click-to-expand. Deliberately narrow so
 * tests can drive grouping decisions from controlled pixel coordinates without
 * a real WebGL context (see FakeMaplibreMap). */
export interface ClusterMapLike {
  project(lngLat: [number, number]): { x: number; y: number };
  /** Inverse of `project()`. Needed because a bubble's anchor is derived in
   * screen space and has to be handed back to MapLibre as lng/lat — see
   * `_anchorOf`. */
  unproject(point: [number, number]): { lng: number; lat: number };
  getZoom(): number;
  getMaxZoom(): number;
  /** The rendered map viewport, in CSS pixels — what bounds how far a
   * click-to-expand may zoom before throwing the group's own members off
   * screen. `clientWidth`/`clientHeight` rather than the canvas's backing-store
   * `width`/`height`, which are multiplied by devicePixelRatio and so do not
   * match `project()`'s coordinate space. */
  getCanvas(): { clientWidth: number; clientHeight: number };
  easeTo(options: { center: [number, number]; zoom: number }): unknown;
  on(event: string, handler: (e?: unknown) => void): unknown;
}

interface Point {
  id: string;
  lngLat: [number, number];
  size: number;
}

/** A candidate group's screen-space bounding box plus the largest marker in it,
 * carried per union-find root so a merge's spread test is O(1). */
interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  maxSize: number;
}

interface Bubble {
  ids: Set<string>;
  marker: MarkerLike;
  inner: HTMLElement;
  centroid: [number, number];
  count: number;
  members: Member[];
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Compares two maps by key set only (values — drifting centroids — ignored). */
function keysEqual(a: ReadonlyMap<string, unknown>, b: ReadonlyMap<string, unknown>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a.keys()) if (!b.has(k)) return false;
  return true;
}

/** Minimal union-find over array indices for connected-components grouping. */
class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root]!;
    while (this.parent[i] !== root) {
      const next = this.parent[i]!;
      this.parent[i] = root;
      i = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/**
 * Groups entities into count "bubbles" only when their actual on-screen marker
 * circles overlap — each marker is a circle of diameter `EntityConfig.size`, so
 * entities A/B touch when their `map.project()`-ed pixel centers are within
 * `(sizeA + sizeB) / 2`. Grouping is transitive (union-find), recomputed
 * continuously as the camera moves, with per-pair hysteresis to avoid flicker
 * and a cap on how far one group may sprawl (MAX_GROUP_SPREAD_FACTOR) so a
 * chain of just-touching markers doesn't collapse into one viewport-wide
 * bubble. A bubble is anchored at the middle of its members' *screen*
 * footprint (see `_anchorOf`), which is the point that actually looks centred
 * among them under both projections the card offers.
 *
 * Bubbles render as HTML `maplibregl.Marker`s (same substrate as individual
 * entity markers), NOT a GeoJSON layer — so they survive `map.setStyle()` for
 * free (no StyleReattach needed), merge/split via CSS transitions
 * (MarkerAnimator), and expand on click via a plain DOM listener. Individual
 * entity markers for absorbed entities are hidden by EntitiesRenderService,
 * driven by `getHiddenEntityIds()` — this service is the single source of truth
 * for which entities are absorbed; it never touches entity-marker DOM directly.
 */
export class ClusterRenderService {
  private _points: Point[] = [];
  /** Entity id → the lng/lat centroid of the bubble it's currently absorbed
   * into. EntitiesRenderService reads this to spring each absorbed marker
   * toward/away from its bubble (see getAbsorbed). */
  private _absorbed = new Map<string, [number, number]>();
  private readonly _bubbles = new Map<string, Bubble>();
  private _groupedPairs = new Set<string>();
  private _enabled = true;
  private _maxZoom = DEFAULT_MAX_ZOOM;
  private _bubbleSeq = 0;

  constructor(
    private readonly map: ClusterMapLike,
    private readonly gl: MapLibreGlLike,
    private readonly layerRegistry: LayerRegistry,
    private readonly onVisibilityChange: () => void,
  ) {
    // Regroup only when the camera *settles*, not on every "move" frame —
    // screen-space distances between markers only change with zoom (a pure pan
    // translates every marker equally), and running the merge/split spring
    // while the camera is still moving makes the captured pixel offset go stale
    // mid-flight, so the animation looks janky. Recomputing at rest instead
    // lets the spring play against a static camera, matching how Home
    // Assistant's own Leaflet map animates its clusters on zoomend. Attached
    // once to the live Map instance (not the style), so they survive setStyle()
    // on their own — same convention as the old engine.
    this.map.on("zoomend", () => this._recompute());
    this.map.on("moveend", () => this._recompute());
  }

  update(entities: EntityConfig[], hass: HomeAssistant, options: ClusterOptions = {}): void {
    this._maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM;
    const points: Point[] = [];
    for (const ent of entities) {
      // Mirror EntitiesRenderService: a hidden-marker entity has no marker to
      // absorb into a bubble, so it never participates in clustering.
      if (ent.geojson?.hideMarker) continue;
      const st = hass.states[ent.id];
      const lng = ent.fixedX ?? st?.attributes?.longitude;
      const lat = ent.fixedY ?? st?.attributes?.latitude;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      points.push({ id: ent.id, lngLat: [lng as number, lat as number], size: ent.size });
    }
    this._points = points;

    this.layerRegistry.registerOverlay(OVERLAY_ID, {
      label: "Clusters",
      group: "cluster",
      setVisible: (_map, visible) => {
        this._enabled = visible;
        if (!visible) {
          this._clearBubbles(false);
          this._absorbed = new Map();
        } else {
          this._recompute();
        }
        this.onVisibilityChange();
      },
    });

    // project() is synchronous geometry (no tile/source-load dependency), so
    // unlike the old GeoJSON-source engine this can recompute immediately.
    this._recompute();
  }

  /** Entity id → the centroid (lng/lat) of the bubble it's absorbed into, for
   * the individual marker to spring toward/away from; empty when the overlay
   * is toggled off (so every marker shows). */
  getAbsorbed(): ReadonlyMap<string, [number, number]> {
    return this._enabled ? this._absorbed : new Map();
  }

  removeAll(): void {
    this.layerRegistry.unregister(OVERLAY_ID);
    this._clearBubbles(false);
    this._points = [];
    this._absorbed = new Map();
    this._groupedPairs = new Set();
  }

  private _recompute(): void {
    if (!this._enabled) return;

    const groups = this._computeGroups();

    const newAbsorbed = new Map<string, [number, number]>();
    const usedPrev = new Set<string>();
    // Snapshot of bubbles that existed *before* this pass — only these are
    // candidates for disposal. Bubbles created during the loop below must not
    // be swept by the same pass (they'd be deleted the instant they're born).
    const prevBubbleIds = [...this._bubbles.keys()];

    for (const group of groups) {
      const memberIds = group.map((m) => m.id);
      const count = group.length;
      const members: Member[] = group.map((m) => ({ xy: m.xy, size: m.size }));
      const centroid = this._anchorOf(members);
      for (const id of memberIds) newAbsorbed.set(id, centroid);

      const prevId = this._bestOverlap(memberIds, usedPrev);
      if (prevId) {
        usedPrev.add(prevId);
        const bubble = this._bubbles.get(prevId)!;
        bubble.ids = new Set(memberIds);
        bubble.centroid = centroid;
        bubble.members = members;
        if (bubble.count !== count) {
          bubble.count = count;
          applyClusterBubbleVisual(bubble.inner, count);
        }
        bubble.marker.setLngLat(centroid);
      } else {
        this._createBubble(memberIds, centroid, count, members);
      }
    }

    // Any previous bubble not carried forward has fully dispersed — animate out.
    for (const id of prevBubbleIds) {
      if (usedPrev.has(id)) continue;
      const bubble = this._bubbles.get(id);
      if (!bubble) continue;
      this._bubbles.delete(id);
      animateConverge(bubble.inner, 0, 0, () => bubble.marker.remove());
    }

    // Notify only when the *set* of absorbed entities changes — the centroids
    // drift continuously as the camera moves, but a marker's spring is captured
    // once at the moment it's absorbed/released, so per-frame drift needn't
    // re-fire the resync. (The map is still refreshed either way so a
    // getAbsorbed() read this frame sees the current centroids.)
    const membershipChanged = !keysEqual(newAbsorbed, this._absorbed);
    this._absorbed = newAbsorbed;
    if (membershipChanged) this.onVisibilityChange();
  }

  /**
   * The point a bubble is anchored at: the centre of the smallest circle
   * enclosing its members' **screen** positions, converted back to lng/lat.
   * `smallestEnclosingCircle` documents why that particular point and not the
   * arithmetic mean, which is density-biased.
   *
   * Working in screen space and unprojecting is the other half of it. Averaging
   * the members' raw lng/lat — which is what this did — only finds the visual
   * midpoint under a linear projection, and neither projection this card offers
   * is linear. Web Mercator's latitude axis is logarithmic, so the error grows
   * with the group's latitude span and with distance from the equator; the
   * default `projection: globe` is nonlinear in *both* axes, and increasingly
   * so away from the globe's centre, where a lng/lat mean can land outside the
   * members it stands for. It also survives the antimeridian, where averaging
   * lng 179 and −179 yields 0 and throws the bubble half a world away.
   *
   * The `xy` values here are the same ones grouping was decided from
   * (`_computeGroups` projected them this pass), so no extra projection work is
   * done and the anchor cannot disagree with the collision test that formed the
   * group.
   */
  private _anchorOf(members: Member[]): [number, number] {
    const centre = smallestEnclosingCircle(members.map((m) => m.xy));
    const { lng, lat } = this.map.unproject([centre.x, centre.y]);
    return [lng, lat];
  }

  /** Screen-space union-find grouping with hysteresis and a spread cap. Returns
   * only groups of size >= 2 (singletons stay individual markers). */
  private _computeGroups(): Array<Array<Point & { xy: { x: number; y: number } }>> {
    const points = this._points;
    if (points.length < 2 || this.map.getZoom() >= this._maxZoom) {
      this._groupedPairs = new Set();
      return [];
    }

    const screen = points.map((p) => ({ ...p, xy: this.map.project(p.lngLat) }));
    const uf = new UnionFind(screen.length);
    const nextGroupedPairs = new Set<string>();

    // Pass 1: every pair whose marker circles overlap, with per-pair hysteresis
    // on the touch distance.
    const candidates: Array<{ i: number; j: number; dist: number; key: string }> = [];
    for (let i = 0; i < screen.length; i++) {
      for (let j = i + 1; j < screen.length; j++) {
        const a = screen[i]!;
        const b = screen[j]!;
        const dist = Math.hypot(a.xy.x - b.xy.x, a.xy.y - b.xy.y);
        const touch = (a.size + b.size) / 2;
        const key = pairKey(a.id, b.id);
        const factor = this._groupedPairs.has(key) ? SPLIT_FACTOR : MERGE_FACTOR;
        if (dist < touch * factor) candidates.push({ i, j, dist, key });
      }
    }

    // Pass 2: merge tightest-pair-first, refusing any merge that would push the
    // resulting group past MAX_GROUP_SPREAD_FACTOR. Order matters: taking the
    // closest pairs first means a chain that has to break breaks at its loosest
    // link rather than wherever the index order happened to reach the cap.
    candidates.sort((a, b) => a.dist - b.dist);
    const extents: Extent[] = screen.map((s) => ({
      minX: s.xy.x,
      maxX: s.xy.x,
      minY: s.xy.y,
      maxY: s.xy.y,
      maxSize: s.size,
    }));
    for (const { i, j, key } of candidates) {
      const ra = uf.find(i);
      const rb = uf.find(j);
      if (ra === rb) {
        // Already in one group (directly or transitively) — still a grouped
        // pair for hysteresis purposes.
        nextGroupedPairs.add(key);
        continue;
      }
      const merged = mergeExtents(extents[ra]!, extents[rb]!);
      if (spreadOf(merged) > merged.maxSize * MAX_GROUP_SPREAD_FACTOR) continue;
      uf.union(i, j);
      extents[uf.find(i)] = merged;
      nextGroupedPairs.add(key);
    }
    // A pair rejected by the cap is deliberately NOT recorded: it is not
    // grouped, so next pass it must clear the tighter merge threshold again.
    this._groupedPairs = nextGroupedPairs;

    const byRoot = new Map<number, Array<Point & { xy: { x: number; y: number } }>>();
    screen.forEach((s, i) => {
      const root = uf.find(i);
      (byRoot.get(root) ?? byRoot.set(root, []).get(root)!).push(s);
    });
    return [...byRoot.values()].filter((g) => g.length >= 2);
  }

  /** Reuses whichever surviving previous bubble shares the most members with
   * this group (best-effort identity continuity across frames — worst case is
   * one extra remount animation on an ambiguous simultaneous split+merge, not
   * incorrect grouping). */
  private _bestOverlap(memberIds: string[], usedPrev: Set<string>): string | null {
    let bestId: string | null = null;
    let bestOverlap = 0;
    for (const [id, bubble] of this._bubbles) {
      if (usedPrev.has(id)) continue;
      let overlap = 0;
      for (const m of memberIds) if (bubble.ids.has(m)) overlap++;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestId = id;
      }
    }
    return bestOverlap > 0 ? bestId : null;
  }

  private _createBubble(memberIds: string[], centroid: [number, number], count: number, members: Member[]): void {
    const id = `bubble-${this._bubbleSeq++}`;
    const inner = buildClusterBubbleElement(count);
    const bubble: Bubble = {
      ids: new Set(memberIds),
      marker: new this.gl.Marker({ element: wrapAnimatedMarker(inner) }).setLngLat(centroid).addTo(this.map),
      inner,
      centroid,
      count,
      members,
    };
    inner.addEventListener("click", () => {
      const canvas = this.map.getCanvas();
      // cluster_max_zoom, not the map's own maximum: at or above it clustering
      // is off entirely, so the group has certainly expanded and going deeper
      // only discards context. (Clamped by the map's ceiling in case a config
      // sets cluster_max_zoom above it.)
      const ceiling = Math.min(this._maxZoom, this.map.getMaxZoom());
      const zoom = computeExpansionZoom(bubble.members, this.map.getZoom(), ceiling, {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });
      this.map.easeTo({ center: bubble.centroid, zoom });
    });
    // Bubble scales/fades in place (offset 0) as its members converge into it.
    animateEmerge(inner, 0, 0);
    this._bubbles.set(id, bubble);
  }

  private _clearBubbles(animate: boolean): void {
    for (const [id, bubble] of [...this._bubbles]) {
      this._bubbles.delete(id);
      if (animate) animateConverge(bubble.inner, 0, 0, () => bubble.marker.remove());
      else bubble.marker.remove();
    }
  }
}

function mergeExtents(a: Extent, b: Extent): Extent {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
    maxSize: Math.max(a.maxSize, b.maxSize),
  };
}

/** Diagonal of the bounding box, in pixels — the group's widest reach. */
function spreadOf(e: Extent): number {
  return Math.hypot(e.maxX - e.minX, e.maxY - e.minY);
}
