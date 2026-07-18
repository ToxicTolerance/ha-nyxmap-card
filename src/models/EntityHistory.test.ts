import { describe, expect, it } from "vitest";
import { EntityHistory } from "./EntityHistory";

describe("EntityHistory.hasPath", () => {
  it("is false for zero or one points", () => {
    expect(new EntityHistory("a", [], "#fff").hasPath).toBe(false);
    expect(new EntityHistory("a", [[1, 2]], "#fff").hasPath).toBe(false);
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
