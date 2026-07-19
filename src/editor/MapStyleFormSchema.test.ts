import { describe, expect, it } from "vitest";
import { buildMapStyleSchema } from "./MapStyleFormSchema";

describe("buildMapStyleSchema", () => {
  it("requires name and map_style but not map_style_dark", () => {
    const schema = buildMapStyleSchema();
    expect(schema.find((s) => s.name === "name")).toMatchObject({ required: true });
    expect(schema.find((s) => s.name === "map_style")).toMatchObject({ required: true });
    expect(schema.find((s) => s.name === "map_style_dark")).not.toMatchObject({ required: true });
  });

  it("offers optional max_zoom/min_zoom for the style's own coverage limit", () => {
    const schema = buildMapStyleSchema();
    expect(schema.find((s) => s.name === "max_zoom")).not.toMatchObject({ required: true });
    expect(schema.find((s) => s.name === "min_zoom")).not.toMatchObject({ required: true });
  });
});
