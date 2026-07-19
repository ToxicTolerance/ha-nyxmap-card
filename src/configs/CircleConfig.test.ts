import { describe, expect, it } from "vitest";
import { CircleConfig } from "./CircleConfig";

describe("CircleConfig", () => {
  it("returns undefined when the raw circle key is unset", () => {
    expect(CircleConfig.from(undefined)).toBeUndefined();
  });

  it('parses "auto" shorthand as an enabled auto-source circle using the default color', () => {
    const cfg = CircleConfig.from("auto", "#ff0000")!;
    expect(cfg.source).toBe("auto");
    expect(cfg.color).toBe("#ff0000");
    expect(cfg.radius).toBe(0);
    expect(cfg.fillOpacity).toBe(0.1);
  });

  it("parses an object config with explicit fields", () => {
    const cfg = CircleConfig.from(
      { radius: 25, color: "#00ff00", fill_opacity: 0.4, source: "config" },
      "#ff0000",
    )!;
    expect(cfg.source).toBe("config");
    expect(cfg.radius).toBe(25);
    expect(cfg.color).toBe("#00ff00");
    expect(cfg.fillOpacity).toBe(0.4);
  });

  it("falls back to the entity's default color when none is given", () => {
    const cfg = CircleConfig.from({ radius: 10 }, "#123456")!;
    expect(cfg.color).toBe("#123456");
  });

  it("infers source: attribute when an attribute is given without an explicit source", () => {
    const cfg = CircleConfig.from({ attribute: "battery_range" })!;
    expect(cfg.source).toBe("attribute");
    expect(cfg.attribute).toBe("battery_range");
  });

  it("defaults to source: auto with no radius/attribute given", () => {
    const cfg = CircleConfig.from({})!;
    expect(cfg.source).toBe("auto");
    expect(cfg.radius).toBe(0);
  });
});
