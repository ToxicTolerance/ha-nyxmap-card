// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./NyxmapCardEditor";
import type { NyxmapCardEditor } from "./NyxmapCardEditor";
import { MapConfig, type MapConfigRaw } from "../configs/MapConfig";
import type { NyxmapFormListEditor } from "./NyxmapFormListEditor";

async function mount(): Promise<NyxmapCardEditor> {
  const el = document.createElement("nyxmap-card-editor") as NyxmapCardEditor;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function listEditors(el: NyxmapCardEditor): NyxmapFormListEditor[] {
  return [...el.shadowRoot!.querySelectorAll("nyxmap-form-list-editor")] as unknown as NyxmapFormListEditor[];
}

function onConfigChanged(el: NyxmapCardEditor) {
  const spy = vi.fn();
  el.addEventListener("config-changed", spy as EventListener);
  return spy;
}

describe("NyxmapCardEditor", () => {
  let el: NyxmapCardEditor;

  beforeEach(async () => {
    el = await mount();
  });

  it("renders nothing before setConfig is called", () => {
    expect(el.shadowRoot!.querySelector("ha-form")).toBeNull();
  });

  it("renders a card-level ha-form and two list editors once configured", async () => {
    el.setConfig({ title: "My Map", entities: ["device_tracker.a"] });
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("ha-form")).not.toBeNull();
    const lists = listEditors(el);
    expect(lists).toHaveLength(2);
  });

  it("dispatches config-changed with an updated field when the card-level ha-form changes, preserving type/unknown keys", async () => {
    const config: MapConfigRaw = { type: "custom:nyxmap-card", title: "Old", zoom: 5, tile_layers: { url: "x" } };
    el.setConfig(config);
    await el.updateComplete;

    const spy = onConfigChanged(el);
    const form = el.shadowRoot!.querySelector("ha-form")!;
    form.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: { title: "New", zoom: 5 } },
        bubbles: true,
        composed: true,
      }),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const detail = (spy.mock.calls[0]![0] as CustomEvent<{ config: MapConfigRaw }>).detail;
    expect(detail.config.title).toBe("New");
    expect(detail.config.type).toBe("custom:nyxmap-card");
    expect(detail.config.tile_layers).toEqual({ url: "x" });
  });

  it("preserves circle/geojson on an untouched entity when another entity's row is edited", async () => {
    el.setConfig({
      entities: [
        { entity: "person.alice", circle: "auto", geojson: { attribute: "geo_location" } },
        { entity: "device_tracker.phone" },
      ],
    });
    await el.updateComplete;

    const spy = onConfigChanged(el);
    const [entitiesEditor] = listEditors(el);
    entitiesEditor!.dispatchEvent(
      new CustomEvent("items-changed", {
        detail: {
          items: [
            { entity: "person.alice", color: "#ff0000" },
            { entity: "device_tracker.phone", label: "Phone" },
          ],
        },
        bubbles: true,
        composed: true,
      }),
    );

    const detail = (spy.mock.calls[0]![0] as CustomEvent<{ config: MapConfigRaw }>).detail;
    const alice = detail.config.entities!.find((e) => typeof e !== "string" && e.entity === "person.alice");
    expect(alice).toMatchObject({
      entity: "person.alice",
      color: "#ff0000",
      circle: "auto",
      geojson: { attribute: "geo_location" },
    });
  });

  it("keeps each entity's own circle/geojson attached when rows are reordered", async () => {
    el.setConfig({
      entities: [
        { entity: "person.alice", circle: "auto" },
        { entity: "device_tracker.phone", geojson: "geo_location" },
      ],
    });
    await el.updateComplete;

    const spy = onConfigChanged(el);
    const [entitiesEditor] = listEditors(el);
    // Simulate a reorder: the list editor emits the same row data, swapped.
    entitiesEditor!.dispatchEvent(
      new CustomEvent("items-changed", {
        detail: {
          items: [{ entity: "device_tracker.phone" }, { entity: "person.alice" }],
        },
        bubbles: true,
        composed: true,
      }),
    );

    const detail = (spy.mock.calls[0]![0] as CustomEvent<{ config: MapConfigRaw }>).detail;
    const [first, second] = detail.config.entities! as Array<Record<string, unknown>>;
    expect(first).toMatchObject({ entity: "device_tracker.phone", geojson: "geo_location" });
    expect(second).toMatchObject({ entity: "person.alice", circle: "auto" });
  });

  // Code-review §14: matching previous rows by entity id alone meant a rename
  // missed the lookup and fell back to an empty { entity }, dropping every key
  // the visual editor doesn't cover.
  it("keeps YAML-only keys when an entity is renamed in place", async () => {
    el.setConfig({
      entities: [
        { entity: "person.alcie", circle: { radius: 500, color: "#f00" }, geojson: { attribute: "geo_shape" } },
        { entity: "device_tracker.phone" },
      ],
    });
    await el.updateComplete;

    const spy = onConfigChanged(el);
    const [entitiesEditor] = listEditors(el);
    entitiesEditor!.dispatchEvent(
      new CustomEvent("items-changed", {
        detail: {
          // Typo corrected in row 0; row 1 untouched.
          items: [{ entity: "person.alice" }, { entity: "device_tracker.phone" }],
        },
        bubbles: true,
        composed: true,
      }),
    );

    const detail = (spy.mock.calls[0]![0] as CustomEvent<{ config: MapConfigRaw }>).detail;
    const [first, second] = detail.config.entities! as Array<Record<string, unknown>>;
    expect(first).toMatchObject({
      entity: "person.alice",
      circle: { radius: 500, color: "#f00" },
      geojson: { attribute: "geo_shape" },
    });
    expect(second).toMatchObject({ entity: "device_tracker.phone" });
  });

  it("does not resurrect a removed entity's keys onto the rows that shift up", async () => {
    // Removal changes the list length, so positional matching must stay off —
    // otherwise row 1's config would slide onto row 0.
    el.setConfig({
      entities: [
        { entity: "person.alice", circle: "auto" },
        { entity: "device_tracker.phone", geojson: "geo_location" },
      ],
    });
    await el.updateComplete;

    const spy = onConfigChanged(el);
    const [entitiesEditor] = listEditors(el);
    entitiesEditor!.dispatchEvent(
      new CustomEvent("items-changed", {
        detail: { items: [{ entity: "device_tracker.phone" }] },
        bubbles: true,
        composed: true,
      }),
    );

    const detail = (spy.mock.calls[0]![0] as CustomEvent<{ config: MapConfigRaw }>).detail;
    expect(detail.config.entities).toHaveLength(1);
    expect(detail.config.entities![0]).toMatchObject({ entity: "device_tracker.phone", geojson: "geo_location" });
    expect(detail.config.entities![0]).not.toHaveProperty("circle");
  });

  it("gives a newly added blank row no inherited keys", async () => {
    el.setConfig({ entities: [{ entity: "person.alice", circle: "auto" }] });
    await el.updateComplete;

    const spy = onConfigChanged(el);
    const [entitiesEditor] = listEditors(el);
    entitiesEditor!.dispatchEvent(
      new CustomEvent("items-changed", {
        detail: { items: [{ entity: "person.alice" }, { entity: "" }] },
        bubbles: true,
        composed: true,
      }),
    );

    const detail = (spy.mock.calls[0]![0] as CustomEvent<{ config: MapConfigRaw }>).detail;
    const [, added] = detail.config.entities! as Array<Record<string, unknown>>;
    // The blank row is emitted verbatim on purpose: `entity` is the row's
    // identity key (EntityConfigRaw requires it, and the id-matching above is
    // written against the "" sentinel). What used to break was the *parse*
    // side, which threw on it — MapConfig now skips it, see below.
    expect(added).toEqual({ entity: "" });
  });

  it("emits a config that MapConfig can still parse while a blank row is half-filled", () => {
    // Regression: "+ Add entity" emitted { entity: "" }, MapConfig mapped it
    // eagerly through EntityConfig.from, which threw — replacing the live
    // preview (and the saved card) with an HA error card.
    const config: MapConfigRaw = { entities: [{ entity: "person.alice" }, { entity: "" }] };
    expect(() => new MapConfig(config)).not.toThrow();
    expect(new MapConfig(config).entities.map((e) => e.id)).toEqual(["person.alice"]);
  });

  it("drops a cleared text field from the emitted entity instead of writing an empty string", async () => {
    el.setConfig({ entities: [{ entity: "person.alice", label: "Alice", icon: "mdi:account" }] });
    await el.updateComplete;

    const spy = onConfigChanged(el);
    const [entitiesEditor] = listEditors(el);
    entitiesEditor!.dispatchEvent(
      new CustomEvent("items-changed", {
        detail: { items: [{ entity: "person.alice", label: "", icon: "" }] },
        bubbles: true,
        composed: true,
      }),
    );

    const detail = (spy.mock.calls[0]![0] as CustomEvent<{ config: MapConfigRaw }>).detail;
    const [first] = detail.config.entities! as Array<Record<string, unknown>>;
    expect(first).toEqual({ entity: "person.alice" });
  });

  it("keeps YAML-only keys through an entity id typed one character at a time", async () => {
    // The intermediate states of a rename are ids that match nothing at all.
    el.setConfig({ entities: [{ entity: "person.alice", geojson: { attribute: "geo_shape" } }] });
    await el.updateComplete;

    const spy = onConfigChanged(el);
    const [entitiesEditor] = listEditors(el);
    for (const entity of ["person.alic", "person.ali", "person.bob"]) {
      entitiesEditor!.dispatchEvent(
        new CustomEvent("items-changed", {
          detail: { items: [{ entity }] },
          bubbles: true,
          composed: true,
        }),
      );
    }

    const last = spy.mock.calls.at(-1)![0] as CustomEvent<{ config: MapConfigRaw }>;
    expect(last.detail.config.entities![0]).toMatchObject({
      entity: "person.bob",
      geojson: { attribute: "geo_shape" },
    });
  });

  it("updates map_styles when the styles list editor emits items-changed", async () => {
    el.setConfig({});
    await el.updateComplete;

    const spy = onConfigChanged(el);
    const [, stylesEditor] = listEditors(el);
    stylesEditor!.dispatchEvent(
      new CustomEvent("items-changed", {
        detail: { items: [{ name: "Streets", map_style: "https://example.com/streets.json" }] },
        bubbles: true,
        composed: true,
      }),
    );

    const detail = (spy.mock.calls[0]![0] as CustomEvent<{ config: MapConfigRaw }>).detail;
    expect(detail.config.map_styles).toEqual([{ name: "Streets", map_style: "https://example.com/streets.json" }]);
  });
});
