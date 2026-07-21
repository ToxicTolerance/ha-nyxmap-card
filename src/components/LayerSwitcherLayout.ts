import type { SwitcherOverlayItem } from "./LayerSwitcherControl";

/**
 * Pure geometry and grouping for the layer switcher, kept DOM-free so it runs
 * under vitest's default "node" environment — the `src/editor/` precedent
 * applied to layout math.
 *
 * This split is not cosmetic. jsdom implements no layout, so every
 * `getBoundingClientRect()` inside the Lit element returns zeros and any
 * assertion against the real arithmetic there would be vacuous. Reading rects
 * and assigning styles stays in the element; the arithmetic lives here where
 * it can actually be tested.
 */

/** The slice of DOMRect this math uses. */
export interface LayoutRect {
  top: number;
  right: number;
  bottom: number;
}

export interface SwitcherOffsets {
  top: number;
  right: number;
}

/** Fallback inset used when MapLibre's control column isn't in the DOM yet,
 * and the gap between that column and the toggle beneath it. */
export const SWITCHER_INSET_PX = 8;
/** Rendered height of the toggle button itself. */
const TOGGLE_HEIGHT_PX = 37;
/** Breathing room between the bottom of the panel and the map's bottom edge. */
const PANEL_BOTTOM_INSET_PX = 8;
/** Never squeeze the panel below this, even on a very short map — it scrolls
 * internally instead. */
const MIN_PANEL_HEIGHT_PX = 120;

/**
 * Where to pin the switcher toggle: directly beneath MapLibre's top-right
 * control column, right-aligned with the buttons *in* that column.
 *
 * `ctrl` is deliberately an individual control rather than the column
 * container: MapLibre insets each control from the column edge by its own
 * margin, so measuring the container would leave the toggle visibly offset
 * from the zoom buttons above it.
 *
 * The column's height is not a constant — the "Toggle grouping" button is only
 * present when clustering is on — which is why this tracks the rendered bottom
 * edge instead of using a fixed offset.
 */
export function computeSwitcherOffsets(
  parent: LayoutRect,
  column: LayoutRect | null,
  ctrl: LayoutRect | null,
): SwitcherOffsets {
  if (!column || !ctrl) return { top: SWITCHER_INSET_PX, right: SWITCHER_INSET_PX };
  return {
    top: Math.round(column.bottom - parent.top + SWITCHER_INSET_PX),
    right: Math.round(parent.right - ctrl.right),
  };
}

/**
 * How tall the panel may get. It opens downward from the toggle, so the room
 * available is the map height minus the toggle's own offset, the toggle
 * itself, and a bottom inset. Anything taller scrolls internally rather than
 * overflowing and being clipped by ha-card's `overflow: hidden`.
 */
export function computeMaxPanelHeight(parentHeight: number, topOffset: number): number {
  const available = parentHeight - topOffset - (TOGGLE_HEIGHT_PX + PANEL_BOTTOM_INSET_PX);
  return Math.max(MIN_PANEL_HEIGHT_PX, available);
}

/** Human labels for the `group` keys the card's own render services register. */
const OVERLAY_GROUP_LABELS: Record<string, string> = {
  history: "History",
  circle: "Accuracy circles",
  geojson: "GeoJSON",
  raster: "Tile layers",
  cluster: "Clustering",
};

/** Heading used for overlays that declare no group at all. */
const UNGROUPED_LABEL = "Overlays";

export interface OverlayGroup {
  key: string;
  label: string;
  items: SwitcherOverlayItem[];
}

/**
 * Buckets overlays by their `group`, preserving first-appearance order so the
 * panel reads in registration order rather than an arbitrary alphabetical one.
 *
 * `group` was set by every registrar and declared in the plugin-author-facing
 * `nyxmap-plugin.d.ts` and README, but nothing ever read it — overlays all
 * rendered as one flat list. A plugin author who set it got nothing and had no
 * way to tell. Unknown keys (which is what a plugin's own group is) fall back
 * to the raw key as the label, so a plugin can name its own section.
 */
export function groupOverlays(overlays: readonly SwitcherOverlayItem[]): OverlayGroup[] {
  const groups: OverlayGroup[] = [];
  const byKey = new Map<string, OverlayGroup>();
  for (const overlay of overlays) {
    const key = overlay.group ?? "";
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: key ? (OVERLAY_GROUP_LABELS[key] ?? key) : UNGROUPED_LABEL, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(overlay);
  }
  return groups;
}
