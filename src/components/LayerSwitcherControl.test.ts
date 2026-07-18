// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./LayerSwitcherControl";
import type { LayerSwitcherControl } from "./LayerSwitcherControl";

async function mount(): Promise<LayerSwitcherControl> {
  const el = document.createElement("nyxmap-layer-switcher") as LayerSwitcherControl;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function openPanel(el: LayerSwitcherControl): void {
  el.shadowRoot!.querySelector<HTMLButtonElement>(".toggle")!.click();
}

describe("LayerSwitcherControl", () => {
  let el: LayerSwitcherControl;

  beforeEach(async () => {
    el = await mount();
  });

  it("renders a closed toggle button with no panel by default", () => {
    expect(el.shadowRoot!.querySelector(".toggle")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".panel")).toBeNull();
  });

  it("opens the panel on toggle click and lists base styles + overlays", async () => {
    el.baseStyles = [
      { id: "light", label: "Light", active: true },
      { id: "dark", label: "Dark", active: false },
    ];
    el.overlays = [{ id: "history-a", label: "History: a", group: "history", active: true }];
    await el.updateComplete;

    openPanel(el);
    await el.updateComplete;

    const radios = el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    const checkboxes = el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(radios).toHaveLength(2);
    expect(checkboxes).toHaveLength(1);
    expect(radios[0]!.checked).toBe(true);
    expect(radios[1]!.checked).toBe(false);
  });

  it("calls onSelectBaseStyle with the id when a radio is chosen", async () => {
    const onSelectBaseStyle = vi.fn();
    el.baseStyles = [
      { id: "light", label: "Light", active: true },
      { id: "dark", label: "Dark", active: false },
    ];
    el.onSelectBaseStyle = onSelectBaseStyle;
    await el.updateComplete;
    openPanel(el);
    await el.updateComplete;

    const darkRadio = el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]!;
    darkRadio.checked = true;
    darkRadio.dispatchEvent(new Event("change"));

    expect(onSelectBaseStyle).toHaveBeenCalledWith("dark");
  });

  it("calls onToggleOverlay with the id when a checkbox is toggled", async () => {
    const onToggleOverlay = vi.fn();
    el.overlays = [{ id: "history-a", label: "History: a", active: true }];
    el.onToggleOverlay = onToggleOverlay;
    await el.updateComplete;
    openPanel(el);
    await el.updateComplete;

    const checkbox = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.dispatchEvent(new Event("change"));

    expect(onToggleOverlay).toHaveBeenCalledWith("history-a");
  });

  it("omits a group entirely when it has no entries", async () => {
    el.overlays = [{ id: "history-a", label: "History: a", active: true }];
    await el.updateComplete;
    openPanel(el);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });
});
