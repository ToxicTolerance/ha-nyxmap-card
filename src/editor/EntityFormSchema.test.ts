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
    expect(entityRawToFormData(raw)).toEqual({ entity: "person.alice", color: "#123456", circle: true });
  });

  it("omits circle from form data when unset, so the schema default (checked) applies", () => {
    expect(entityRawToFormData({ entity: "person.alice" }).circle).toBeUndefined();
  });

  it("maps an explicit circle: false to a false checkbox", () => {
    expect(entityRawToFormData({ entity: "person.alice", circle: false }).circle).toBe(false);
  });

  it("maps a circle object config to a checked checkbox", () => {
    expect(entityRawToFormData({ entity: "person.alice", circle: { radius: 10 } }).circle).toBe(true);
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

  it("unchecking the circle toggle sets circle: false", () => {
    const next = formDataToEntityRaw({ entity: "person.alice", circle: false }, { entity: "person.alice" });
    expect(next.circle).toBe(false);
  });

  it("re-checking a previously-false circle toggle clears it back to unset", () => {
    const next = formDataToEntityRaw(
      { entity: "person.alice", circle: true },
      { entity: "person.alice", circle: false },
    );
    expect(next.circle).toBeUndefined();
  });

  it("checking the circle toggle preserves an existing advanced circle object untouched", () => {
    const previous: EntityConfigRaw = { entity: "person.alice", circle: { radius: 10, color: "#ff0000" } };
    const next = formDataToEntityRaw({ entity: "person.alice", circle: true }, previous);
    expect(next.circle).toEqual({ radius: 10, color: "#ff0000" });
  });
});
