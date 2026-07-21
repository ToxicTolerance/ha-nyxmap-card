// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EntityConfig } from "../configs/EntityConfig";
import type { HassEntity } from "../types/home-assistant";
import {
  applyMarkerVisual,
  buildClusterBubbleElement,
  buildMarkerElement,
  colorFromString,
  initials,
  markerVisualKey,
  wrapAnimatedMarker,
} from "./MarkerFactory";

function stateOf(entityId: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  return { entity_id: entityId, state, last_changed: "", last_updated: "", attributes };
}

describe("initials", () => {
  it("takes the first letter of up to two words, split on space/underscore/dot", () => {
    expect(initials("John Doe")).toBe("JD");
    expect(initials("living_room.sensor")).toBe("LR");
    expect(initials("solo")).toBe("S");
  });
});

describe("colorFromString", () => {
  it("is deterministic for the same input", () => {
    expect(colorFromString("device_tracker.phone")).toBe(colorFromString("device_tracker.phone"));
  });

  it("produces an hsl() string", () => {
    expect(colorFromString("x")).toMatch(/^hsl\(\d+, 60%, 45%\)$/);
  });

  // Regression: the 32-bit hash accumulator goes negative and JS `%` keeps the
  // sign, so these two real entity ids used to yield hsl(-257, …) / hsl(-235, …).
  // CSS tolerates a negative hue; MapLibre's spec-compliant paint-property
  // colour parser (history line-color, circle fill) need not.
  it.each(["device_tracker.phone", "sensor.a", "person.bob", "zone.home", "light.kitchen_ceiling"])(
    "never emits a negative hue for %s",
    (id) => {
      const hue = Number(/^hsl\((-?\d+),/.exec(colorFromString(id))![1]);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    },
  );
});

describe("buildMarkerElement fallback chain", () => {
  it("prefers a picture over an icon when display is not 'icon'", () => {
    const cfg = EntityConfig.from({ entity: "person.a", picture: "/local/a.jpg", icon: "mdi:account" });
    const el = buildMarkerElement(cfg);
    expect(el.classList.contains("nyxmap-marker--picture")).toBe(true);
    expect(el.style.backgroundImage).toContain("/local/a.jpg");
  });

  it("uses the icon when display is 'icon' even if a picture is set", () => {
    const cfg = EntityConfig.from({
      entity: "person.a",
      display: "icon",
      picture: "/local/a.jpg",
      icon: "mdi:account",
    });
    const el = buildMarkerElement(cfg);
    expect(el.classList.contains("nyxmap-marker--icon")).toBe(true);
    expect(el.querySelector("ha-icon")?.getAttribute("icon")).toBe("mdi:account");
  });

  it("falls back to initials when neither picture nor icon is available", () => {
    const cfg = EntityConfig.from({ entity: "device_tracker.phone" });
    const el = buildMarkerElement(cfg);
    expect(el.classList.contains("nyxmap-marker--initials")).toBe(true);
    expect(el.textContent).toBe(initials("device_tracker.phone"));
  });

  it("prefers an explicit label over computed initials", () => {
    const cfg = EntityConfig.from({ entity: "device_tracker.phone", label: "P" });
    const el = buildMarkerElement(cfg);
    expect(el.textContent).toBe("P");
  });

  it("falls back to the state's entity_picture/icon/friendly_name when config omits them", () => {
    const cfg = EntityConfig.from({ entity: "person.a" });
    const el = buildMarkerElement(cfg, {
      entity_id: "person.a",
      state: "home",
      last_changed: "",
      last_updated: "",
      attributes: { friendly_name: "Alice Bob", entity_picture: "/local/state.jpg" },
    });
    expect(el.classList.contains("nyxmap-marker--picture")).toBe(true);
  });
});

// display: "state" was offered in the visual editor's dropdown and typed in
// EntityDisplay but consumed by nothing — it rendered identically to
// display: "marker". Implemented (rather than removed from the union) because
// upstream ha-map-card renders the state value for this mode.
describe("display: 'state'", () => {
  it("renders the entity's state value, outranking both picture and icon", () => {
    const cfg = EntityConfig.from({
      entity: "sensor.outdoor_temperature",
      display: "state",
      picture: "/local/a.jpg",
      icon: "mdi:thermometer",
    });
    const el = buildMarkerElement(cfg, stateOf("sensor.outdoor_temperature", "21.5"));

    expect(el.textContent).toBe("21.5");
    expect(el.classList.contains("nyxmap-marker--initials")).toBe(true);
    expect(el.classList.contains("nyxmap-marker--picture")).toBe(false);
    expect(el.querySelector("ha-icon")).toBeNull();
  });

  // A state value has no bounded length, so it gets the pill treatment rather
  // than the fixed-diameter disc that would clip it.
  it("clears the inline width so the marker can grow to fit the value", () => {
    const cfg = EntityConfig.from({ entity: "person.alice", display: "state", size: 40 });
    const el = buildMarkerElement(cfg, stateOf("person.alice", "Not home"));

    expect(el.classList.contains("nyxmap-marker--state")).toBe(true);
    expect(el.style.width).toBe("");
    // Height still comes from `size`, so short values match other markers.
    expect(el.style.height).toBe("40px");
    expect(el.style.getPropertyValue("--nyxmap-marker-size")).toBe("40px");
  });

  it("drops the state pill again when the same node is redrawn as an icon", () => {
    const el = buildMarkerElement(
      EntityConfig.from({ entity: "person.alice", display: "state", size: 40 }),
      stateOf("person.alice", "Not home"),
    );
    applyMarkerVisual(el, EntityConfig.from({ entity: "person.alice", icon: "mdi:car", size: 40 }));

    expect(el.classList.contains("nyxmap-marker--state")).toBe(false);
    expect(el.style.width).toBe("40px");
  });

  it("falls back to label, then initials, when there is no state object", () => {
    expect(buildMarkerElement(EntityConfig.from({ entity: "sensor.x", display: "state", label: "L" })).textContent).toBe(
      "L",
    );
    expect(buildMarkerElement(EntityConfig.from({ entity: "sensor.x", display: "state" })).textContent).toBe(
      initials("sensor.x"),
    );
  });
});

describe("applyMarkerVisual (in-place redraw)", () => {
  it("swaps a picture marker to an icon marker on the same node, clearing prior state", () => {
    const el = buildMarkerElement(EntityConfig.from({ entity: "person.a", picture: "/local/a.jpg" }));
    expect(el.style.backgroundImage).toContain("/local/a.jpg");

    applyMarkerVisual(el, EntityConfig.from({ entity: "person.a", display: "icon", icon: "mdi:car" }));

    expect(el.style.backgroundImage).toBe("");
    expect(el.classList.contains("nyxmap-marker--picture")).toBe(false);
    expect(el.classList.contains("nyxmap-marker--icon")).toBe(true);
    expect(el.querySelector("ha-icon")?.getAttribute("icon")).toBe("mdi:car");
  });

  it("leaves the base class and any in-flight animation state alone", () => {
    const el = buildMarkerElement(EntityConfig.from({ entity: "person.a" }));
    el.classList.add("nyxmap-anim-out");
    el.style.setProperty("--nyxmap-anim-dx", "12px");

    applyMarkerVisual(el, EntityConfig.from({ entity: "person.a", picture: "/local/b.jpg" }));

    expect(el.classList.contains("nyxmap-marker")).toBe(true);
    expect(el.classList.contains("nyxmap-anim-out")).toBe(true);
    expect(el.style.getPropertyValue("--nyxmap-anim-dx")).toBe("12px");
  });

  it("drops a stale ha-icon child instead of accumulating one per redraw", () => {
    const cfg = EntityConfig.from({ entity: "person.a", icon: "mdi:home" });
    const el = buildMarkerElement(cfg);
    applyMarkerVisual(el, EntityConfig.from({ entity: "person.a", icon: "mdi:car" }));

    expect(el.querySelectorAll("ha-icon")).toHaveLength(1);
    expect(el.querySelector("ha-icon")?.getAttribute("icon")).toBe("mdi:car");
  });
});

describe("markerVisualKey", () => {
  it("changes when a rotated entity_picture token, a templated icon or a rename lands", () => {
    const cfg = EntityConfig.from({ entity: "person.a" });
    const base = markerVisualKey(cfg, stateOf("person.a", "home", { entity_picture: "/api/image_proxy/x?tok=1" }));

    expect(markerVisualKey(cfg, stateOf("person.a", "home", { entity_picture: "/api/image_proxy/x?tok=1" }))).toBe(base);
    expect(
      markerVisualKey(cfg, stateOf("person.a", "home", { entity_picture: "/api/image_proxy/x?tok=2" })),
    ).not.toBe(base);
    expect(markerVisualKey(cfg, stateOf("person.a", "home", { icon: "mdi:car" }))).not.toBe(base);
    expect(markerVisualKey(cfg, stateOf("person.a", "home", { friendly_name: "Alice" }))).not.toBe(base);
  });

  // Regression: zIndexOffset was only ever applied at marker creation
  // (wrapAnimatedMarker), and wasn't keyed here either — so raising an
  // entity's z_index_offset in the visual editor did nothing until the card
  // was rebuilt.
  it("changes when z_index_offset changes", () => {
    const base = markerVisualKey(EntityConfig.from({ entity: "person.a" }));

    expect(markerVisualKey(EntityConfig.from({ entity: "person.a", z_index_offset: 1 }))).toBe(base);
    expect(markerVisualKey(EntityConfig.from({ entity: "person.a", z_index_offset: 10 }))).not.toBe(base);
  });

  it("ignores a state change unless display is 'state' (a move must not rebuild the DOM)", () => {
    const marker = EntityConfig.from({ entity: "person.a" });
    expect(markerVisualKey(marker, stateOf("person.a", "home"))).toBe(
      markerVisualKey(marker, stateOf("person.a", "not_home")),
    );

    const asState = EntityConfig.from({ entity: "person.a", display: "state" });
    expect(markerVisualKey(asState, stateOf("person.a", "home"))).not.toBe(
      markerVisualKey(asState, stateOf("person.a", "not_home")),
    );
  });
});

describe("wrapAnimatedMarker", () => {
  it("nests the inner element inside a .nyxmap-marker-anchor wrapper", () => {
    const inner = document.createElement("div");
    inner.className = "nyxmap-marker";
    const wrapper = wrapAnimatedMarker(inner);

    expect(wrapper.className).toBe("nyxmap-marker-anchor");
    expect(wrapper.firstElementChild).toBe(inner);
    expect(wrapper.style.zIndex).toBe("");
  });

  // z_index_offset was parsed by EntityConfig and editable in the visual
  // editor but read by nothing. It goes on the wrapper because that's the node
  // maplibregl.Marker absolutely-positions in the shared marker container.
  it("applies z_index_offset to the wrapper (the node MapLibre positions)", () => {
    const wrapper = wrapAnimatedMarker(document.createElement("div"), 7);
    expect(wrapper.style.zIndex).toBe("7");
  });
});

describe("buildClusterBubbleElement", () => {
  it("labels the bubble with the raw count below 1000 and abbreviates above", () => {
    expect(buildClusterBubbleElement(3).textContent).toBe("3");
    expect(buildClusterBubbleElement(1200).textContent).toBe("1.2k");
    expect(buildClusterBubbleElement(2000).textContent).toBe("2k");
  });

  it("steps diameter by member count (colour is theme-driven via CSS, not inline)", () => {
    const small = buildClusterBubbleElement(3);
    const mid = buildClusterBubbleElement(10);
    const large = buildClusterBubbleElement(50);

    expect(small.style.width).toBe("32px");
    expect(mid.style.width).toBe("40px");
    expect(large.style.width).toBe("52px");
    // No inline colour — .nyxmap-cluster-bubble takes the theme's --primary-color.
    expect(small.style.getPropertyValue("--nyxmap-cluster-color")).toBe("");
  });
});
