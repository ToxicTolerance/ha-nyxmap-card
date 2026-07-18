// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EntityConfig } from "../configs/EntityConfig";
import { buildMarkerElement, colorFromString, initials } from "./MarkerFactory";

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
