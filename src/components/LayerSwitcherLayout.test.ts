import { describe, expect, it } from "vitest";
import { computeMaxPanelHeight, computeSwitcherOffsets, groupOverlays } from "./LayerSwitcherLayout";
import type { SwitcherOverlayItem } from "./LayerSwitcherControl";

function overlay(id: string, group?: string): SwitcherOverlayItem {
  return { id, label: id, group, active: true };
}

describe("computeSwitcherOffsets", () => {
  it("stacks the toggle below the control column with an 8px gap", () => {
    const offsets = computeSwitcherOffsets(
      { top: 100, right: 500, bottom: 400 },
      { top: 110, right: 490, bottom: 180 },
      { top: 110, right: 490, bottom: 180 },
    );

    // column.bottom (180) − parent.top (100) + 8
    expect(offsets.top).toBe(88);
  });

  it("right-aligns to the control, not the column, so buttons line up", () => {
    const offsets = computeSwitcherOffsets(
      { top: 0, right: 500, bottom: 400 },
      { top: 0, right: 500, bottom: 100 }, // column runs to the parent's edge
      { top: 0, right: 490, bottom: 100 }, // the control is inset by 10
    );

    expect(offsets.right).toBe(10);
  });

  it("falls back to the plain inset when the control column isn't in the DOM yet", () => {
    const parent = { top: 100, right: 500, bottom: 400 };

    expect(computeSwitcherOffsets(parent, null, null)).toEqual({ top: 8, right: 8 });
    // A column with no control inside it is equally unmeasurable.
    expect(computeSwitcherOffsets(parent, { top: 0, right: 0, bottom: 0 }, null)).toEqual({ top: 8, right: 8 });
  });

  it("rounds to whole pixels", () => {
    const offsets = computeSwitcherOffsets(
      { top: 0.4, right: 500.6, bottom: 400 },
      { top: 0, right: 0, bottom: 180.3 },
      { top: 0, right: 490.2, bottom: 0 },
    );

    expect(Number.isInteger(offsets.top)).toBe(true);
    expect(Number.isInteger(offsets.right)).toBe(true);
  });
});

describe("computeMaxPanelHeight", () => {
  it("leaves room for the toggle and a bottom inset", () => {
    // 400 − 88 − (37 + 8)
    expect(computeMaxPanelHeight(400, 88)).toBe(267);
  });

  it("never squeezes below the 120px floor on a short map", () => {
    expect(computeMaxPanelHeight(150, 88)).toBe(120);
    expect(computeMaxPanelHeight(0, 8)).toBe(120);
  });
});

describe("groupOverlays", () => {
  it("renders ungrouped overlays as a single 'Overlays' section", () => {
    const groups = groupOverlays([overlay("a"), overlay("b")]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("Overlays");
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("buckets by group and gives the card's own groups human labels", () => {
    const groups = groupOverlays([
      overlay("history-a", "history"),
      overlay("circle-a", "circle"),
      overlay("history-b", "history"),
    ]);

    expect(groups.map((g) => g.label)).toEqual(["History", "Accuracy circles"]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["history-a", "history-b"]);
  });

  it("preserves first-appearance order rather than sorting", () => {
    const groups = groupOverlays([overlay("r", "raster"), overlay("g", "geojson"), overlay("h", "history")]);

    expect(groups.map((g) => g.key)).toEqual(["raster", "geojson", "history"]);
  });

  it("lets a plugin name its own section via an unknown group key", () => {
    const groups = groupOverlays([overlay("plugin:heat", "Heatmaps")]);

    expect(groups[0]!.label).toBe("Heatmaps");
  });

  it("returns nothing for no overlays, so the panel renders no empty section", () => {
    expect(groupOverlays([])).toEqual([]);
  });
});
