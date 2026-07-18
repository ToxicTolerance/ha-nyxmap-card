import { describe, expect, it } from "vitest";
import { MapConfig } from "../configs/MapConfig";
import { resolveStyle, resolveThemeMode } from "./HaMapUtilities";

describe("resolveThemeMode", () => {
  it("follows the system preference when auto", () => {
    expect(resolveThemeMode("auto", true)).toBe("dark");
    expect(resolveThemeMode("auto", false)).toBe("light");
  });

  it("ignores the system preference when explicit", () => {
    expect(resolveThemeMode("light", true)).toBe("light");
    expect(resolveThemeMode("dark", false)).toBe("dark");
  });
});

describe("resolveStyle", () => {
  it("picks styleDark/styleLight to match the resolved theme", () => {
    const cfg = new MapConfig({
      map_style: "https://example.com/light.json",
      map_style_dark: "https://example.com/dark.json",
      theme_mode: "auto",
    });
    expect(resolveStyle(cfg, true)).toBe("https://example.com/dark.json");
    expect(resolveStyle(cfg, false)).toBe("https://example.com/light.json");
  });
});
