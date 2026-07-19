// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./NyxmapCardEditor";
import type { NyxmapCardEditor } from "./NyxmapCardEditor";
import type { MapConfigRaw } from "../configs/MapConfig";
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
