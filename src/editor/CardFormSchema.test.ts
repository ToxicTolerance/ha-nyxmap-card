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

  it("puts x/y/zoom/max_zoom/min_zoom in a grid row", () => {
    const grid = buildCardSchema().find((s) => s.type === "grid");
    expect(grid?.schema.map((s) => s.name)).toEqual(["x", "y", "zoom", "max_zoom", "min_zoom"]);
  });

  it("exposes cluster_max_zoom as a standalone field in the behavior section", () => {
    const behavior = buildCardSchema().find((s) => s.name === "behavior");
    const names = behavior?.type === "expandable" ? behavior.schema.map((s) => s.name) : [];
    expect(names).toContain("cluster_max_zoom");
    // No cluster_radius field anymore, and no grid pairing it with max_zoom.
    expect(names).not.toContain("cluster_radius");
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

  it("round-trips card-level max_zoom/min_zoom", () => {
    // Regression: max_zoom/min_zoom capped the camera correctly at runtime
    // but had no field in the visual editor at all, so an existing value
    // was invisible/uneditable there (silently preserved only because
    // formDataToCardConfig starts from a spread of the previous config).
    const config: MapConfigRaw = { max_zoom: 19, min_zoom: 10 };
    const formData = cardConfigToFormData(config);
    expect(formData.max_zoom).toBe(19);
    expect(formData.min_zoom).toBe(10);

    const updated = formDataToCardConfig({ ...formData, max_zoom: 18 }, config);
    expect(updated.max_zoom).toBe(18);
    expect(updated.min_zoom).toBe(10);
  });

  it("round-trips history_show_lines/history_show_dots/cluster_markers", () => {
    // Regression: these were added to MapConfig (v0.6.0) without ever being
    // added to the visual editor's schema, mirroring the earlier max_zoom/
    // min_zoom gap above.
    const config: MapConfigRaw = {
      history_show_lines: false,
      history_show_dots: true,
      cluster_markers: true,
    };
    const formData = cardConfigToFormData(config);
    expect(formData.history_show_lines).toBe(false);
    expect(formData.history_show_dots).toBe(true);
    expect(formData.cluster_markers).toBe(true);

    const updated = formDataToCardConfig({ ...formData, cluster_markers: false }, config);
    expect(updated.history_show_lines).toBe(false);
    expect(updated.history_show_dots).toBe(true);
    expect(updated.cluster_markers).toBe(false);
  });

  it("round-trips cluster_max_zoom", () => {
    const config: MapConfigRaw = { cluster_max_zoom: 16 };
    const formData = cardConfigToFormData(config);
    expect(formData.cluster_max_zoom).toBe(16);

    const updated = formDataToCardConfig({ ...formData, cluster_max_zoom: 12 }, config);
    expect(updated.cluster_max_zoom).toBe(12);
  });

  it("round-trips show_accuracy_circles", () => {
    const config: MapConfigRaw = { show_accuracy_circles: false };
    const formData = cardConfigToFormData(config);
    expect(formData.show_accuracy_circles).toBe(false);

    const updated = formDataToCardConfig({ ...formData, show_accuracy_circles: true }, config);
    expect(updated.show_accuracy_circles).toBe(true);
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
