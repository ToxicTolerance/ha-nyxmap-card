import { describe, expect, it } from "vitest";
import type { MapConfigRaw } from "../configs/MapConfig";
import { buildCardSchema, buildStubConfig, cardConfigToFormData, formDataToCardConfig } from "./CardFormSchema";

describe("buildCardSchema", () => {
  it("groups appearance and behavior fields into flattened expandable sections", () => {
    const schema = buildCardSchema();
    const appearance = schema.find((s) => s.name === "appearance");
    const behavior = schema.find((s) => s.name === "behavior");

    expect(appearance).toMatchObject({ type: "expandable", flatten: true });
    expect(behavior).toMatchObject({ type: "expandable", flatten: true });
  });

  it("puts x/y/zoom in a grid row", () => {
    const grid = buildCardSchema().find((s) => s.type === "grid");
    expect(grid?.schema.map((s) => s.name)).toEqual(["x", "y", "zoom"]);
  });
});

describe("cardConfigToFormData / formDataToCardConfig", () => {
  it("round-trips schema-covered fields while preserving unrelated keys", () => {
    const config: MapConfigRaw = {
      title: "My Map",
      zoom: 10,
      entities: ["device_tracker.a"],
      tile_layers: { url: "https://example.com/{z}/{x}/{y}.png" },
      map_styles: [{ name: "Streets", map_style: "https://example.com/streets.json" }],
    };

    const formData = cardConfigToFormData(config);
    expect(formData.title).toBe("My Map");
    expect(formData.zoom).toBe(10);

    const updated = formDataToCardConfig({ ...formData, title: "New Title" }, config);
    expect(updated.title).toBe("New Title");
    expect(updated.entities).toEqual(["device_tracker.a"]);
    expect(updated.tile_layers).toEqual(config.tile_layers);
    expect(updated.map_styles).toEqual(config.map_styles);
  });

  it("converts a numeric-looking height string back to a number", () => {
    const updated = formDataToCardConfig({ height: "350" }, {});
    expect(updated.height).toBe(350);
  });

  it("keeps a CSS-length height as a string", () => {
    const updated = formDataToCardConfig({ height: "50vh" }, {});
    expect(updated.height).toBe("50vh");
  });

  it("clears height back to the default when the field is emptied", () => {
    const updated = formDataToCardConfig({ height: "" }, { height: 350 });
    expect(updated.height).toBeUndefined();
  });

  it("renders a numeric height as a string for the form field", () => {
    expect(cardConfigToFormData({ height: 350 }).height).toBe("350");
  });
});

describe("buildStubConfig", () => {
  it("returns an empty entities list when hass is unavailable", () => {
    expect(buildStubConfig()).toEqual({ entities: [] });
  });

  it("seeds the first device_tracker/person entity found in hass.states", () => {
    const hass = {
      states: { "sensor.temp": {}, "person.alice": {} },
      callWS: async () => ({}),
      language: "en",
    } as unknown as Parameters<typeof buildStubConfig>[0];

    expect(buildStubConfig(hass)).toEqual({ entities: ["person.alice"] });
  });
});
