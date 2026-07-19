import { describe, expect, it } from "vitest";
import { CircleConfig } from "../configs/CircleConfig";
import type { HassEntity } from "../types/home-assistant";
import { resolveCircleRadius } from "./Circle";

function stateWith(attributes: Record<string, unknown>): HassEntity {
  return {
    entity_id: "device_tracker.phone",
    state: "home",
    attributes,
    last_changed: "",
    last_updated: "",
  };
}

describe("resolveCircleRadius", () => {
  it("source: config uses the config's own radius, ignoring attributes", () => {
    const cfg = new CircleConfig({ source: "config", radius: 15 });
    expect(resolveCircleRadius(cfg, stateWith({ gps_accuracy: 999 }))).toBe(15);
  });

  it("source: attribute reads the named attribute", () => {
    const cfg = new CircleConfig({ source: "attribute", attribute: "battery_range" });
    expect(resolveCircleRadius(cfg, stateWith({ battery_range: 42 }))).toBe(42);
  });

  it("source: attribute falls back to 0 when the attribute is missing or non-numeric", () => {
    const cfg = new CircleConfig({ source: "attribute", attribute: "missing" });
    expect(resolveCircleRadius(cfg, stateWith({}))).toBe(0);
  });

  it("source: gps_accuracy reads gps_accuracy specifically", () => {
    const cfg = new CircleConfig({ source: "gps_accuracy" });
    expect(resolveCircleRadius(cfg, stateWith({ gps_accuracy: 30, radius: 999 }))).toBe(30);
  });

  it("auto prefers gps_accuracy over a radius attribute", () => {
    const cfg = new CircleConfig({ source: "auto" });
    expect(resolveCircleRadius(cfg, stateWith({ gps_accuracy: 30, radius: 99 }))).toBe(30);
  });

  it("auto falls back to the radius attribute when gps_accuracy is absent", () => {
    const cfg = new CircleConfig({ source: "auto" });
    expect(resolveCircleRadius(cfg, stateWith({ radius: 99 }))).toBe(99);
  });

  it("auto falls back to the config's radius when no attributes apply", () => {
    const cfg = new CircleConfig({ source: "auto", radius: 12 });
    expect(resolveCircleRadius(cfg, stateWith({}))).toBe(12);
  });

  it("auto resolves to 0 with no state, no attributes, and no config radius", () => {
    const cfg = new CircleConfig({ source: "auto" });
    expect(resolveCircleRadius(cfg, undefined)).toBe(0);
  });
});
