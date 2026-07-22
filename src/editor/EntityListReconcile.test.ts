import { describe, expect, it } from "vitest";
import { reconcileEntityList } from "./EntityListReconcile";
import { entityRawToFormData } from "./EntityFormSchema";
import type { EntityConfigRaw } from "../configs/EntityConfig";

/** A YAML-only key the visual form does not cover — the thing this whole
 * function exists to carry across an edit. */
const withGeoJson = (entity: string): EntityConfigRaw =>
  ({ entity, geojson: { attribute: "shape", color: "#ff0000" } }) as unknown as EntityConfigRaw;

/** Round-trips through the form mapping the way the list editor does. */
const rowsFor = (previous: EntityConfigRaw[]) => previous.map(entityRawToFormData);

describe("reconcileEntityList", () => {
  it("carries YAML-only keys through an in-place edit", () => {
    const previous = [withGeoJson("device_tracker.a")];
    const rows = rowsFor(previous);
    rows[0]!.label = "Phone";

    const result = reconcileEntityList(rows, previous);

    expect(result[0]).toMatchObject({ entity: "device_tracker.a", label: "Phone" });
    expect(result[0]).toHaveProperty("geojson");
  });

  // Rows physically swap slots, so positional matching would cross-wire a's
  // geojson onto b.
  it("matches by id through a reorder", () => {
    const previous = [withGeoJson("device_tracker.a"), { entity: "device_tracker.b" } as EntityConfigRaw];
    const rows = [...rowsFor(previous)].reverse();

    const result = reconcileEntityList(rows, previous);

    expect(result.map((r) => r.entity)).toEqual(["device_tracker.b", "device_tracker.a"]);
    expect(result[0]).not.toHaveProperty("geojson");
    expect(result[1]).toHaveProperty("geojson");
  });

  // An id lookup misses on the new id and used to fall back to a bare
  // { entity: id }, silently dropping every key outside the form schema.
  it("matches by position through a rename, keeping the renamed entity's keys", () => {
    const previous = [withGeoJson("device_tracker.typo")];
    const rows = rowsFor(previous);
    rows[0]!.entity = "device_tracker.fixed";

    const result = reconcileEntityList(rows, previous);

    expect(result[0]!.entity).toBe("device_tracker.fixed");
    expect(result[0]).toHaveProperty("geojson");
  });

  it("matches by id on an add, leaving the new row bare", () => {
    const previous = [withGeoJson("device_tracker.a")];
    const rows = [...rowsFor(previous), { entity: "device_tracker.new" }];

    const result = reconcileEntityList(rows, previous);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty("geojson");
    expect(result[1]).toEqual({ entity: "device_tracker.new" });
  });

  it("matches by id on a remove, without shifting keys onto the wrong entity", () => {
    const previous = [
      { entity: "device_tracker.a" } as EntityConfigRaw,
      withGeoJson("device_tracker.b"),
      { entity: "device_tracker.c" } as EntityConfigRaw,
    ];
    const rows = rowsFor(previous).filter((r) => r.entity !== "device_tracker.a");

    const result = reconcileEntityList(rows, previous);

    expect(result.map((r) => r.entity)).toEqual(["device_tracker.b", "device_tracker.c"]);
    expect(result[0]).toHaveProperty("geojson");
    expect(result[1]).not.toHaveProperty("geojson");
  });

  it("handles bare-string entity entries, which are legal YAML", () => {
    const previous: Array<string | EntityConfigRaw> = ["device_tracker.a"];
    const rows = [{ entity: "device_tracker.a", label: "A" }];

    const result = reconcileEntityList(rows, previous);

    expect(result[0]).toMatchObject({ entity: "device_tracker.a", label: "A" });
  });

  it("returns an empty list when everything was removed", () => {
    expect(reconcileEntityList([], [withGeoJson("device_tracker.a")])).toEqual([]);
  });
});
