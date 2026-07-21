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

  it("projects only schema-covered keys, converting a hex color to an [r,g,b] picker value", () => {
    const raw: EntityConfigRaw = {
      entity: "person.alice",
      color: "#123456",
      circle: "auto",
      geojson: "geo_location",
    };
    expect(entityRawToFormData(raw)).toEqual({
      entity: "person.alice",
      color: [0x12, 0x34, 0x56],
      circle: true,
    });
  });

  it("expands a 3-digit hex color to [r,g,b]", () => {
    expect(entityRawToFormData({ entity: "person.alice", color: "#f00" }).color).toEqual([255, 0, 0]);
  });

  it("omits a non-hex color (e.g. a named/rgb() value) from the picker rather than mangling it", () => {
    expect(entityRawToFormData({ entity: "person.alice", color: "red" }).color).toBeUndefined();
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
  it("preserves circle/geojson/unknown keys and converts a picked [r,g,b] color back to hex", () => {
    const previous: EntityConfigRaw = {
      entity: "person.alice",
      color: "#123456",
      circle: "auto",
      geojson: { attribute: "geo_location" },
    };

    const next = formDataToEntityRaw({ entity: "person.alice", color: [0xab, 0xcd, 0xef] }, previous);

    expect(next.color).toBe("#abcdef");
    expect(next.circle).toBe("auto");
    expect(next.geojson).toEqual({ attribute: "geo_location" });
  });

  it("leaves a non-hex color untouched when the picker never emitted a value for it", () => {
    // A "red" stored value is omitted from the form (see entityRawToFormData),
    // so it isn't in the changed form data and survives via the previous spread.
    const previous: EntityConfigRaw = { entity: "person.alice", color: "red" };
    const next = formDataToEntityRaw({ entity: "person.alice", label: "A" }, previous);
    expect(next.color).toBe("red");
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

  describe("clearing a field", () => {
    // MarkerFactory falls back with `??`, so a "" written over label/icon
    // renders an empty disc / blank glyph instead of the initials or the
    // entity's own icon attribute.
    it.each([
      ["an empty string", ""],
      ["undefined", undefined],
      ["null", null],
    ])("deletes a text key when ha-form reports it as %s", (_label, cleared) => {
      const previous: EntityConfigRaw = { entity: "person.alice", label: "Alice", icon: "mdi:account" };
      const next = formDataToEntityRaw({ entity: "person.alice", label: cleared, icon: cleared }, previous);
      expect(next).not.toHaveProperty("label");
      expect(next).not.toHaveProperty("icon");
    });

    it("deletes a cleared color rather than writing an empty string", () => {
      const previous: EntityConfigRaw = { entity: "person.alice", color: "#123456" };
      const next = formDataToEntityRaw({ entity: "person.alice", color: "" }, previous);
      expect(next).not.toHaveProperty("color");
    });

    it("preserves false and 0 — they are values, not clears", () => {
      const next = formDataToEntityRaw(
        { entity: "person.alice", focus_on_fit: false, size: 0, fixed_x: 0 },
        { entity: "person.alice" },
      );
      expect(next.focus_on_fit).toBe(false);
      expect(next.size).toBe(0);
      expect(next.fixed_x).toBe(0);
    });

    it("leaves an absent key alone rather than treating it as cleared", () => {
      // Unlike the card-level form, absent ≠ cleared here: entityRawToFormData
      // omits values it can't represent (a non-hex color).
      const previous: EntityConfigRaw = { entity: "person.alice", label: "Alice" };
      const next = formDataToEntityRaw({ entity: "person.alice" }, previous);
      expect(next.label).toBe("Alice");
    });

    it("keeps entity as a blank-string sentinel rather than deleting the row's id key", () => {
      const previous: EntityConfigRaw = { entity: "person.alice", geojson: "geo_location" };
      const next = formDataToEntityRaw({ entity: "" }, previous);
      expect(next.entity).toBe("");
      expect(next.geojson).toBe("geo_location");
    });
  });

  it("checking the circle toggle preserves an existing advanced circle object untouched", () => {
    const previous: EntityConfigRaw = { entity: "person.alice", circle: { radius: 10, color: "#ff0000" } };
    const next = formDataToEntityRaw({ entity: "person.alice", circle: true }, previous);
    expect(next.circle).toEqual({ radius: 10, color: "#ff0000" });
  });
});
