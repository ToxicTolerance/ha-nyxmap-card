import { describe, expect, it } from "vitest";
import { MapConfig } from "../configs/MapConfig";
import { isColorDark, resolveStyle, resolveStylePair, resolveThemeMode, resolveTime } from "./HaMapUtilities";

describe("isColorDark", () => {
  it("detects dark hex backgrounds", () => {
    expect(isColorDark("#1c1c1c")).toBe(true);
    expect(isColorDark("#000")).toBe(true);
    expect(isColorDark("#212121")).toBe(true);
  });

  it("detects light hex backgrounds", () => {
    expect(isColorDark("#ffffff")).toBe(false);
    expect(isColorDark("#fff")).toBe(false);
    expect(isColorDark("#fafafa")).toBe(false);
  });

  it("handles rgb()/rgba() forms", () => {
    expect(isColorDark("rgb(28, 28, 28)")).toBe(true);
    expect(isColorDark("rgba(255, 255, 255, 0.9)")).toBe(false);
  });

  it("treats an unset/unrecognised value as light", () => {
    expect(isColorDark("")).toBe(false);
    expect(isColorDark(undefined)).toBe(false);
    expect(isColorDark("var(--x)")).toBe(false);
  });
});

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

describe("resolveStylePair", () => {
  it("resolves an arbitrary light/dark pair the same way resolveStyle does", () => {
    const pair = { styleLight: "a", styleDark: "b" };
    expect(resolveStylePair(pair, "auto", true)).toBe("b");
    expect(resolveStylePair(pair, "auto", false)).toBe("a");
    expect(resolveStylePair(pair, "dark", false)).toBe("b");
  });

  it("pins to one URL when both fields match (the switcher's Light/Dark entries)", () => {
    const pinned = { styleLight: "pinned", styleDark: "pinned" };
    expect(resolveStylePair(pinned, "auto", true)).toBe("pinned");
    expect(resolveStylePair(pinned, "auto", false)).toBe("pinned");
  });
});

describe("resolveTime", () => {
  const now = new Date("2026-07-18T12:00:00.000Z");

  it("resolves relative time phrases against `now`", () => {
    expect(resolveTime("5 hours ago", now)).toEqual(new Date("2026-07-18T07:00:00.000Z"));
    expect(resolveTime("1 day ago", now)).toEqual(new Date("2026-07-17T12:00:00.000Z"));
    expect(resolveTime("2 weeks ago", now)).toEqual(new Date("2026-07-04T12:00:00.000Z"));
    expect(resolveTime("30 minutes ago", now)).toEqual(new Date("2026-07-18T11:30:00.000Z"));
  });

  it("is case-insensitive and tolerates singular units", () => {
    expect(resolveTime("1 HOUR AGO", now)).toEqual(new Date("2026-07-18T11:00:00.000Z"));
  });

  it("resolves an absolute ISO date regardless of `now`", () => {
    expect(resolveTime("2022-03-01T12:00:00Z", now)).toEqual(new Date("2022-03-01T12:00:00Z"));
  });

  it("returns null for an entity-id reference (deferred to Phase 9)", () => {
    expect(resolveTime("input_number.history_hours", now)).toBeNull();
  });

  it("returns null for unparseable garbage instead of an Invalid Date", () => {
    expect(resolveTime("not a date", now)).toBeNull();
  });
});
