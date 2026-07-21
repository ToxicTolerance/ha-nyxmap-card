import type { StyleReattach } from "../../maplibre/StyleReattach";
import type { LayerRegistry } from "./LayerRegistry";

/**
 * The subset of maplibregl.Map every source/layer-backed overlay needs.
 * `getSource` is deliberately `unknown` here — raster sources expose
 * `setTiles()` and GeoJSON sources `setData()`, so the narrowing happens in
 * each subclass's `updateSourceData()` rather than being false-shared.
 */
export interface OverlayMapLike {
  addSource(id: string, source: unknown): unknown;
  addLayer(layer: unknown): unknown;
  getSource(id: string): unknown;
  removeLayer(id: string): unknown;
  removeSource(id: string): unknown;
  setLayoutProperty(layerId: string, name: string, value: unknown): unknown;
  setPaintProperty(layerId: string, name: string, value: unknown): unknown;
}

export interface OverlayLayerSpec {
  id: string;
  layer: unknown;
}

/** Everything needed to draw one overlay once. Built fresh on every upsert and
 * again on every StyleReattach replay, so it always reflects current config
 * and current visibility. */
export interface OverlayBuild {
  /** Spec handed to `addSource()`. */
  source: unknown;
  layers: OverlayLayerSpec[];
  /** Layer-switcher label. */
  label: string;
  /** Layer-switcher grouping key. */
  group: string;
  /**
   * Identity of the parts of `source` that have **no in-place setter**.
   * MapLibre lets you push fresh data into a live source (`setData`/
   * `setTiles`) but has no setter for a source's own `minzoom`/`maxzoom`/
   * `attribution` — those are read once, at `addSource()` time. When this key
   * changes the source is torn down and re-added instead of updated in place.
   * Overlays whose source carries nothing but data return a constant.
   */
  sourceKey: string;
  /**
   * Identity of every paint value the layers bake in, as one comparable
   * string — the same "store a visual key, redraw only when it changes"
   * precedent as `MarkerFactory.markerVisualKey`. JSON rather than a delimiter
   * join because a CSS colour can itself contain commas and spaces
   * (`rgb(1, 2, 3)`), so two distinct field tuples could otherwise collide by
   * concatenation.
   */
  paintKey: string;
}

/**
 * Base for every overlay rendered as MapLibre sources/layers rather than HTML
 * markers (history trails, accuracy circles, entity GeoJSON, raster tile/WMS
 * layers, and plugin overlays).
 *
 * All of those must do the same five things, and each used to do them by hand:
 *
 *  1. add the source + layers, or update the source in place if it's already
 *     there, reconciling the layer set (which can change between updates);
 *  2. push changed paint onto layers that survived, since `setData()` only
 *     carries geometry and layers keep whatever paint they were added with;
 *  3. register a `StyleReattach` factory, because `map.setStyle()` (theme
 *     swap) wipes every source and layer — see CLAUDE.md's "one non-obvious
 *     invariant";
 *  4. register a `LayerRegistry` overlay so it appears in the layer switcher,
 *     tracking visibility here so a hidden overlay stays hidden through a
 *     reattach replay; and
 *  5. tear all four of those down symmetrically on removal.
 *
 * Five hand-rolled copies meant every fix to this protocol had to be applied
 * five times — and the wave-2 paint fix missed a branch doing exactly that.
 * Subclasses now supply only what actually differs: the id, the source spec,
 * the layer specs, the two identity keys, and how to update a live source.
 */
export abstract class OverlaySource<TKey, TItem> {
  private readonly activeKeys = new Set<TKey>();
  private readonly visibility = new Map<string, boolean>();
  private readonly layerIds = new Map<string, string[]>();
  private readonly paintKeys = new Map<string, string>();
  private readonly sourceKeys = new Map<string, string>();

  constructor(
    protected readonly map: OverlayMapLike,
    private readonly reattach: StyleReattach,
    private readonly layerRegistry: LayerRegistry,
  ) {}

  /** Source id for a key — always via `OverlayIds`, never a local literal. */
  protected abstract sourceIdFor(key: TKey): string;

  /** Build the source + layer specs for one item at a given visibility. Must
   * be pure: it is re-run on every StyleReattach replay. */
  protected abstract build(key: TKey, item: TItem, visible: boolean): OverlayBuild;

  /** Push fresh data into a source that already exists (`setData`/`setTiles`). */
  protected abstract updateSourceData(source: unknown, build: OverlayBuild): void;

  /** Re-apply config-driven paint to layers that survived this update. Called
   * only when `paintKey` changed, and only with layers that were *not* just
   * added (those already carry the current paint). */
  protected applyPaint(_id: string, _item: TItem, _survivingLayerIds: string[]): void {}

  /** Hook for per-overlay setup that isn't a source or a layer — GeoJSON's
   * layer-scoped click handlers. Runs once, when the key first becomes active. */
  protected onAdded(_id: string, _key: TKey): void {}

  /** Mirror of `onAdded`, run before the source and layers are destroyed. */
  protected onRemoving(_id: string, _key: TKey): void {}

  removeAll(): void {
    for (const key of [...this.activeKeys]) this.remove(key);
  }

  has(key: TKey): boolean {
    return this.activeKeys.has(key);
  }

  /** Drop every active key that wasn't in this update's `seen` set. */
  protected reconcile(seen: ReadonlySet<TKey>): void {
    for (const key of [...this.activeKeys]) {
      if (!seen.has(key)) this.remove(key);
    }
  }

  protected upsert(key: TKey, item: TItem): void {
    const id = this.sourceIdFor(key);
    const build = this.build(key, item, this.isVisible(id));

    const existing = this.map.getSource(id);
    // A source option with no setter changed (raster minzoom/maxzoom/
    // attribution), so the live source cannot be updated into the new shape —
    // tear it down and let the add path below rebuild it. Staleness is only
    // meaningful against a key *this* service recorded: a source that exists
    // without one was not added here, so there is nothing to compare and the
    // in-place update path is the safe read.
    const stale =
      existing !== undefined && this.sourceKeys.has(id) && this.sourceKeys.get(id) !== build.sourceKey;
    if (stale) this.destroySource(id);

    if (existing !== undefined && !stale) {
      this.updateSourceData(existing, build);
    } else {
      this.map.addSource(id, build.source);
      if (!this.activeKeys.has(key)) {
        this.activeKeys.add(key);
        this.onAdded(id, key);
      }
    }
    this.sourceKeys.set(id, build.sourceKey);

    // Reconciled against the previously-added layer ids rather than assumed
    // fixed: history_show_lines/_dots can change the layer set between
    // updates, and a rebuilt source has no layers left at all.
    const desiredIds = build.layers.map((spec) => spec.id);
    const previousIds = existing !== undefined && !stale ? (this.layerIds.get(id) ?? []) : [];
    for (const layerId of previousIds) {
      if (!desiredIds.includes(layerId)) this.map.removeLayer(layerId);
    }
    for (const spec of build.layers) {
      if (!previousIds.includes(spec.id)) this.map.addLayer(spec.layer);
    }
    this.layerIds.set(id, desiredIds);

    // Layers added just above already carry the current paint; only the ones
    // that survived from the previous update need it pushed onto them.
    const surviving = desiredIds.filter((layerId) => previousIds.includes(layerId));
    if (this.paintKeys.get(id) !== build.paintKey && surviving.length > 0) {
      this.applyPaint(id, item, surviving);
    }
    this.paintKeys.set(id, build.paintKey);

    // Re-registering on every update keeps the replayed overlay current. The
    // factory rebuilds rather than closing over `build`, so a replay picks up
    // the visibility the overlay has *at replay time* — closing over the
    // already-built layers would resurrect a hidden overlay as visible.
    this.reattach.register(id, (map) => {
      const m = map as unknown as OverlayMapLike;
      if (m.getSource(id) !== undefined) return;
      const fresh = this.build(key, item, this.isVisible(id));
      m.addSource(id, fresh.source);
      for (const spec of fresh.layers) m.addLayer(spec.layer);
      this.layerIds.set(id, fresh.layers.map((spec) => spec.id));
    });

    this.layerRegistry.registerOverlay(id, {
      label: build.label,
      group: build.group,
      setVisible: (map, visible) => {
        this.visibility.set(id, visible);
        const m = map as OverlayMapLike;
        const layout = visible ? "visible" : "none";
        for (const layerId of this.layerIds.get(id) ?? []) {
          m.setLayoutProperty(layerId, "visibility", layout);
        }
      },
    });
  }

  protected remove(key: TKey): void {
    const id = this.sourceIdFor(key);
    this.onRemoving(id, key);
    this.reattach.unregister(id);
    this.layerRegistry.unregister(id);
    this.visibility.delete(id);
    this.paintKeys.delete(id);
    this.sourceKeys.delete(id);
    this.activeKeys.delete(key);
    this.destroySource(id);
    this.layerIds.delete(id);
  }

  private isVisible(id: string): boolean {
    return this.visibility.get(id) ?? true;
  }

  private destroySource(id: string): void {
    if (this.map.getSource(id) === undefined) return;
    for (const layerId of this.layerIds.get(id) ?? []) this.map.removeLayer(layerId);
    this.map.removeSource(id);
  }
}
