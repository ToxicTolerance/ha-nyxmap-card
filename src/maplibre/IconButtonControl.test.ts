// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { IconButtonControl } from "./IconButtonControl";

describe("IconButtonControl", () => {
  it("renders a maplibregl-ctrl-group button with the given icon/label and wires clicks to onClick", () => {
    const onClick = vi.fn();
    const control = new IconButtonControl({ icon: "mdi:group", label: "Toggle grouping", onClick });

    const el = control.onAdd() as HTMLElement;
    expect(el.className).toContain("maplibregl-ctrl-group");

    const button = el.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Toggle grouping");
    expect(button.title).toBe("Toggle grouping");
    expect(button.querySelector("ha-icon")?.getAttribute("icon")).toBe("mdi:group");

    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not set aria-pressed when isPressed is unset", () => {
    const control = new IconButtonControl({ icon: "mdi:image-filter-center-focus", label: "Reset focus", onClick: vi.fn() });
    const el = control.onAdd() as HTMLElement;
    expect(el.querySelector("button")!.hasAttribute("aria-pressed")).toBe(false);
  });

  it("reflects isPressed() via aria-pressed, updated by refresh()", () => {
    let pressed = true;
    const control = new IconButtonControl({
      icon: "mdi:group",
      label: "Toggle grouping",
      onClick: vi.fn(),
      isPressed: () => pressed,
    });
    const el = control.onAdd() as HTMLElement;
    const button = el.querySelector("button")!;
    expect(button.getAttribute("aria-pressed")).toBe("true");

    pressed = false;
    control.refresh();
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("onRemove() detaches the container from the DOM", () => {
    const control = new IconButtonControl({ icon: "mdi:group", label: "Toggle grouping", onClick: vi.fn() });
    const el = control.onAdd() as HTMLElement;
    document.body.appendChild(el);
    expect(document.body.contains(el)).toBe(true);

    control.onRemove();
    expect(document.body.contains(el)).toBe(false);
  });
});
