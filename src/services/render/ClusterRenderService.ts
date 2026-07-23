import type { EntityConfig } from "../../configs/EntityConfig";
import { animateConverge, animateEmerge } from "../../maplibre/MarkerAnimator";
import { applyClusterBubbleVisual, buildClusterBubbleElement, wrapAnimatedMarker } from "../../maplibre/MarkerFactory";
import type { HomeAssistant } from "../../types/home-assistant";
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
  getZoom(): number;
  getMaxZoom(): number;
  easeTo(options: { center: [number, number]; zoom: number }): unknown;
  on(event: string, handler: (e?: unknown) => void): unknown;
}

interface Point {
  id: string;
  lngLat: [number, number];
  size: number;
}

interface Member {
  xy: { x: number; y: number };
  size: number;
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
 * continuously as the camera moves, with per-pair hysteresis to avoid flicker.
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
      const centroid = centroidOf(group.map((m) => m.lngLat));
      const members: Member[] = group.map((m) => ({ xy: m.xy, size: m.size }));
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

  /** Screen-space union-find grouping with hysteresis. Returns only groups of
   * size >= 2 (singletons stay individual markers). */
  private _computeGroups(): Array<Array<Point & { xy: { x: number; y: number } }>> {
    const points = this._points;
    if (points.length < 2 || this.map.getZoom() >= this._maxZoom) {
      this._groupedPairs = new Set();
      return [];
    }

    const screen = points.map((p) => ({ ...p, xy: this.map.project(p.lngLat) }));
    const uf = new UnionFind(screen.length);
    const nextGroupedPairs = new Set<string>();

    for (let i = 0; i < screen.length; i++) {
      for (let j = i + 1; j < screen.length; j++) {
        const a = screen[i]!;
        const b = screen[j]!;
        const dist = Math.hypot(a.xy.x - b.xy.x, a.xy.y - b.xy.y);
        const touch = (a.size + b.size) / 2;
        const key = pairKey(a.id, b.id);
        const factor = this._groupedPairs.has(key) ? SPLIT_FACTOR : MERGE_FACTOR;
        if (dist < touch * factor) {
          uf.union(i, j);
          nextGroupedPairs.add(key);
        }
      }
    }
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
      const zoom = computeExpansionZoom(bubble.members, this.map.getZoom(), this.map.getMaxZoom());
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

function centroidOf(coords: Array<[number, number]>): [number, number] {
  let lng = 0;
  let lat = 0;
  for (const [x, y] of coords) {
    lng += x;
    lat += y;
  }
  return [lng / coords.length, lat / coords.length];
}

/** Target zoom that visually separates a clicked group's members. Uses the
 * Web-Mercator identity that the pixel distance between two fixed lng/lat
 * points doubles per +1 zoom level (at a fixed center), so for the closest
 * colliding pair we can solve for how many levels are needed to clear them
 * without moving the camera to test. Always zooms in at least one level. */
export function computeExpansionZoom(
  members: Member[],
  currentZoom: number,
  maxZoom: number,
): number {
  let maxDelta = 1;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]!;
      const b = members[j]!;
      const dist = Math.hypot(a.xy.x - b.xy.x, a.xy.y - b.xy.y);
      const need = ((a.size + b.size) / 2) * 1.3; // 30% past bare "just touching"
      if (dist >= need) continue;
      const delta = dist < 1e-6 ? 6 : Math.log2(need / dist);
      maxDelta = Math.max(maxDelta, delta);
    }
  }
  return Math.min(currentZoom + maxDelta, maxZoom);
}
