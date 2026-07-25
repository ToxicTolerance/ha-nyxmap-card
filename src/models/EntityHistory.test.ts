import { describe, expect, it } from "vitest";
import { EntityHistory } from "./EntityHistory";

describe("EntityHistory.hasPath", () => {
  it("is false for zero or one points", () => {
    expect(new EntityHistory("a", [], "#fff").hasPath).toBe(false);
    expect(new EntityHistory("a", [[1, 2]], "#fff").hasPath).toBe(false);
  });

  describe("with dots enabled, one point is enough", () => {
    // A LineString needs two points, but a dot needs one. A flat `>= 2` dropped
    // a dots-only trail that had a single sample — along with its layer-switcher
    // entry, so it read as broken rather than as one sample so far.
    it("is true for a single point when showDots is on and lines are off", () => {
      expect(new EntityHistory("a", [[1, 2]], "#fff", false, true).hasPath).toBe(true);
    });

    it("is true for a single point when both lines and dots are on", () => {
      expect(new EntityHistory("a", [[1, 2]], "#fff", true, true).hasPath).toBe(true);
    });

    it("is still false for no points at all", () => {
      expect(new EntityHistory("a", [], "#fff", false, true).hasPath).toBe(false);
    });

    it("still needs two points when only lines are drawn", () => {
      expect(new EntityHistory("a", [[1, 2]], "#fff", true, false).hasPath).toBe(false);
    });
  });

  it("is true for two or more points", () => {
    expect(
      new EntityHistory(
        "a",
        [
          [1, 2],
          [3, 4],
        ],
        "#fff",
      ).hasPath,
    ).toBe(true);
  });
});
