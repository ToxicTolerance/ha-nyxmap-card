import { describe, expect, it } from "vitest";
import type { BaseStyleEntry } from "../services/render/LayerRegistry";
import {
  baseStyleZoomRange,
  defaultBaseStyleId,
  effectiveThemeMode,
  initialManualStyleId,
  resolveActiveStyleUrl,
} from "./BaseStyleResolution";

const config = { styleLight: "card-light.json", styleDark: "card-dark.json" };

function baseStyles(entries: Record<string, BaseStyleEntry>): ReadonlyMap<string, BaseStyleEntry> {
  return new Map(Object.entries(entries));
}

describe("effectiveThemeMode", () => {
  it("prefers the manual override, then config, then auto", () => {
    expect(effectiveThemeMode("dark", "light")).toBe("dark");
    expect(effectiveThemeMode(undefined, "light")).toBe("light");
    expect(effectiveThemeMode(undefined, undefined)).toBe("auto");
  });
});

describe("resolveActiveStyleUrl", () => {
  it("falls back to the card style pair when nothing is manually selected", () => {
    expect(resolveActiveStyleUrl(config, undefined, "light", false, baseStyles({}))).toBe("card-light.json");
    expect(resolveActiveStyleUrl(config, undefined, "dark", false, baseStyles({}))).toBe("card-dark.json");
  });

  it("resolves the manually-selected entry's own light/dark pair against the theme", () => {
    const styles = baseStyles({
      "custom:Foo": { label: "Foo", styleLight: "foo-light.json", styleDark: "foo-dark.json" },
    });
    expect(resolveActiveStyleUrl(config, "custom:Foo", "light", false, styles)).toBe("foo-light.json");
    expect(resolveActiveStyleUrl(config, "custom:Foo", "dark", false, styles)).toBe("foo-dark.json");
  });

  it("follows system preference under auto", () => {
    expect(resolveActiveStyleUrl(config, undefined, "auto", true, baseStyles({}))).toBe("card-dark.json");
    expect(resolveActiveStyleUrl(config, undefined, "auto", false, baseStyles({}))).toBe("card-light.json");
  });

  it("falls back to the card style when the selected id names no registered entry", () => {
    // The C3 case: a map_styles entry deleted after it was picked. The url still
    // resolves sensibly instead of throwing on a missing entry.
    expect(resolveActiveStyleUrl(config, "custom:Gone", "light", false, baseStyles({}))).toBe("card-light.json");
  });
});

describe("initialManualStyleId", () => {
  it("selects the map_styles entry matching the card-level style pair", () => {
    expect(
      initialManualStyleId({
        styleLight: "a.json",
        styleDark: "b.json",
        mapStyles: [
          { name: "Other", styleLight: "x.json", styleDark: "y.json" },
          { name: "Match", styleLight: "a.json", styleDark: "b.json" },
        ],
      }),
    ).toBe("custom:Match");
  });

  it("is undefined when no entry matches (generic Light/Dark then apply)", () => {
    expect(initialManualStyleId({ styleLight: "a.json", styleDark: "b.json", mapStyles: [] })).toBeUndefined();
    expect(
      initialManualStyleId({
        styleLight: "a.json",
        styleDark: "b.json",
        mapStyles: [{ name: "Other", styleLight: "x.json", styleDark: "y.json" }],
      }),
    ).toBeUndefined();
  });
});

describe("defaultBaseStyleId", () => {
  it("matches the resolved theme", () => {
    expect(defaultBaseStyleId("light", false)).toBe("light");
    expect(defaultBaseStyleId("dark", false)).toBe("dark");
    expect(defaultBaseStyleId("auto", true)).toBe("dark");
    expect(defaultBaseStyleId("auto", false)).toBe("light");
  });
});

describe("baseStyleZoomRange", () => {
  it("prefers the entry's own limits", () => {
    const entry: BaseStyleEntry = { label: "x", styleLight: "l", styleDark: "d", maxZoom: 19, minZoom: 3 };
    expect(baseStyleZoomRange(entry, { maxZoom: 22, minZoom: 0 })).toEqual({ maxZoom: 19, minZoom: 3 });
  });

  it("falls back to the card-level limits, then MapLibre's defaults", () => {
    expect(baseStyleZoomRange(undefined, { maxZoom: 21, minZoom: 2 })).toEqual({ maxZoom: 21, minZoom: 2 });
    expect(baseStyleZoomRange(undefined, {})).toEqual({ maxZoom: 22, minZoom: 0 });
  });

  it("takes each bound independently from the first source that sets it", () => {
    const entry: BaseStyleEntry = { label: "x", styleLight: "l", styleDark: "d", maxZoom: 18 };
    expect(baseStyleZoomRange(entry, { minZoom: 4 })).toEqual({ maxZoom: 18, minZoom: 4 });
  });
});
