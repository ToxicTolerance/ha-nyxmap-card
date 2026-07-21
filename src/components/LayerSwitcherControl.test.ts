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

  // HA's Sections/masonry layouts re-parent cards on a dashboard edit, firing
  // disconnect → connect on the *same* element. disconnectedCallback tears
  // down the outside-click listener and the resize observer, and nothing used
  // to put them back.
  it("still closes on an outside pointerdown after being re-parented", async () => {
    openPanel(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".panel")).not.toBeNull();

    // Re-parent: same element, removed and re-added.
    el.remove();
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".panel")).not.toBeNull(); // still open

    // jsdom has no PointerEvent constructor; the handler only reads
    // composedPath(), which a plain composed Event provides.
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector(".panel")).toBeNull();
  });

  it("does not listen for outside pointerdowns while closed", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    el.remove();
    document.body.appendChild(el);
    await el.updateComplete;

    expect(addSpy.mock.calls.filter((c) => c[0] === "pointerdown")).toHaveLength(0);
    addSpy.mockRestore();
  });

  it("groups overlays under their group headings", async () => {
    el.overlays = [
      { id: "history-a", label: "History: a", group: "history", active: true },
      { id: "circle-a", label: "Circle: a", group: "circle", active: true },
      { id: "history-b", label: "History: b", group: "history", active: true },
    ];
    await el.updateComplete;
    openPanel(el);
    await el.updateComplete;

    const labels = [...el.shadowRoot!.querySelectorAll(".group-label")].map((n) => n.textContent);
    expect(labels).toContain("History");
    expect(labels).toContain("Accuracy circles");
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

  it("does not render the Theme group by default (showThemeToggle unset)", async () => {
    el.themeMode = "light";
    await el.updateComplete;
    openPanel(el);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelectorAll('input[name="nyxmap-theme-mode"]')).toHaveLength(0);
  });

  it("renders Auto/Light/Dark radios reflecting themeMode when showThemeToggle is set", async () => {
    el.showThemeToggle = true;
    el.themeMode = "dark";
    await el.updateComplete;
    openPanel(el);
    await el.updateComplete;

    const radios = [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="nyxmap-theme-mode"]')];
    expect(radios).toHaveLength(3);
    const checkedLabel = radios.find((r) => r.checked)?.closest("label")?.textContent?.trim();
    expect(checkedLabel).toBe("Dark");
  });

  it("calls onSelectThemeMode with the chosen mode", async () => {
    const onSelectThemeMode = vi.fn();
    el.showThemeToggle = true;
    el.themeMode = "auto";
    el.onSelectThemeMode = onSelectThemeMode;
    await el.updateComplete;
    openPanel(el);
    await el.updateComplete;

    const radios = [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="nyxmap-theme-mode"]')];
    const lightRadio = radios.find((r) => r.closest("label")?.textContent?.trim() === "Light")!;
    lightRadio.checked = true;
    lightRadio.dispatchEvent(new Event("change"));

    expect(onSelectThemeMode).toHaveBeenCalledWith("light");
  });

  it("omits a group entirely when it has no entries", async () => {
    el.overlays = [{ id: "history-a", label: "History: a", active: true }];
    await el.updateComplete;
    openPanel(el);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });
});
