import { describe, expect, it } from "vitest";
import type { EntityConfigRaw } from "../configs/EntityConfig";
import { buildEntitySchema, entityRawToFormData, formDataToEntityRaw } from "./EntityFormSchema";

describe("buildEntitySchema", () => {
  it("marks entity as required and puts fixed_x/fixed_y in a grid row", () => {
    const schema = buildEntitySchema();
    expect(schema.find((s) => s.name === "entity")).toMatchObject({ required: true });
    const grid = schema.find((s) => s.type === "grid");
    expect(grid?.schema.map((s) => s.name)).toEqual(["fixed_x", "fixed_y"]);
  });
});

describe("entityRawToFormData", () => {
  it("normalizes a bare entity-id string to { entity }", () => {
    expect(entityRawToFormData("device_tracker.phone")).toEqual({ entity: "device_tracker.phone" });
  });

  it("projects only schema-covered keys from a full entity object", () => {
    const raw: EntityConfigRaw = {
      entity: "person.alice",
      color: "#123456",
      circle: "auto",
      geojson: "geo_location",
    };
    expect(entityRawToFormData(raw)).toEqual({ entity: "person.alice", color: "#123456" });
  });
});

describe("formDataToEntityRaw", () => {
  it("preserves circle/geojson/unknown keys when editing an unrelated field", () => {
    const previous: EntityConfigRaw = {
      entity: "person.alice",
      color: "#123456",
      circle: "auto",
      geojson: { attribute: "geo_location" },
    };

    const next = formDataToEntityRaw({ entity: "person.alice", color: "#abcdef" }, previous);

    expect(next.color).toBe("#abcdef");
    expect(next.circle).toBe("auto");
    expect(next.geojson).toEqual({ attribute: "geo_location" });
  });

  it("normalizes a bare-string previous value before merging", () => {
    const next = formDataToEntityRaw({ entity: "device_tracker.phone", label: "Phone" }, "device_tracker.phone");
    expect(next).toEqual({ entity: "device_tracker.phone", label: "Phone" });
  });
});
