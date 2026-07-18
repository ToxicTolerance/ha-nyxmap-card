import { describe, expect, it, vi } from "vitest";
import { LayerRegistry } from "./LayerRegistry";

describe("LayerRegistry", () => {
  it("registers and lists base styles", () => {
    const registry = new LayerRegistry();
    registry.registerBaseStyle("light", { label: "Light", styleLight: "a", styleDark: "a" });
    registry.registerBaseStyle("dark", { label: "Dark", styleLight: "b", styleDark: "b" });

    expect(registry.getBaseStyles().size).toBe(2);
    expect(registry.getBaseStyles().get("light")?.label).toBe("Light");
  });

  it("registers and lists overlays", () => {
    const registry = new LayerRegistry();
    const setVisible = vi.fn();
    registry.registerOverlay("history-a", { label: "History: a", group: "history", setVisible });

    expect(registry.getOverlays().size).toBe(1);
    expect(registry.getOverlays().get("history-a")?.setVisible).toBe(setVisible);
  });

  it("unregister removes an id from either registry", () => {
    const registry = new LayerRegistry();
    registry.registerBaseStyle("light", { label: "Light", styleLight: "a", styleDark: "a" });
    registry.registerOverlay("history-a", { label: "History: a", setVisible: vi.fn() });

    registry.unregister("light");
    registry.unregister("history-a");

    expect(registry.getBaseStyles().size).toBe(0);
    expect(registry.getOverlays().size).toBe(0);
  });

  it("registering under an existing id overwrites the previous entry", () => {
    const registry = new LayerRegistry();
    registry.registerOverlay("history-a", { label: "old", setVisible: vi.fn() });
    registry.registerOverlay("history-a", { label: "new", setVisible: vi.fn() });

    expect(registry.getOverlays().size).toBe(1);
    expect(registry.getOverlays().get("history-a")?.label).toBe("new");
  });
});
