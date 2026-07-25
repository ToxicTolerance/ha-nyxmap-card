// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./NyxmapFormListEditor";
import type { NyxmapFormListEditor } from "./NyxmapFormListEditor";
import type { HaFormSchema } from "../types/ha-form";

interface Item extends Record<string, unknown> {
  name?: string;
}

const schema: HaFormSchema[] = [{ name: "name", selector: { text: {} } }];

async function mount(): Promise<NyxmapFormListEditor<Item>> {
  const el = document.createElement("nyxmap-form-list-editor") as NyxmapFormListEditor<Item>;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function rowButtons(el: NyxmapFormListEditor<Item>, rowIndex: number) {
  const row = el.shadowRoot!.querySelectorAll(".row")[rowIndex]!;
  const buttons = row.querySelectorAll("button");
  return {
    expand: buttons[0] as HTMLButtonElement,
    up: buttons[1] as HTMLButtonElement,
    down: buttons[2] as HTMLButtonElement,
    remove: buttons[3] as HTMLButtonElement,
  };
}

describe("NyxmapFormListEditor", () => {
  let el: NyxmapFormListEditor<Item>;
  let onItemsChanged: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    el = await mount();
    el.schema = schema;
    onItemsChanged = vi.fn();
    el.addEventListener("items-changed", onItemsChanged as EventListener);
  });

  it("renders one row per item with its computed summary", async () => {
    el.items = [{ name: "Alice" }, { name: "Bob" }];
    el.computeRowSummary = (item) => item.name ?? "?";
    await el.updateComplete;

    const summaries = [...el.shadowRoot!.querySelectorAll(".summary")].map((s) => s.textContent?.trim());
    expect(summaries).toEqual(["Alice", "Bob"]);
  });

  it("appends newItemDefaults() and emits items-changed when Add is clicked", async () => {
    el.items = [];
    el.newItemDefaults = () => ({ name: "" });
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLButtonElement>(".add")!.click();

    expect(onItemsChanged).toHaveBeenCalledTimes(1);
    const event = onItemsChanged.mock.calls[0]![0] as CustomEvent<{ items: Item[] }>;
    expect(event.detail.items).toEqual([{ name: "" }]);
  });

  it("removes the clicked row and emits the remaining items", async () => {
    el.items = [{ name: "Alice" }, { name: "Bob" }];
    await el.updateComplete;

    rowButtons(el, 0).remove.click();

    const event = onItemsChanged.mock.calls[0]![0] as CustomEvent<{ items: Item[] }>;
    expect(event.detail.items).toEqual([{ name: "Bob" }]);
  });

  it("swaps adjacent items on move up/down and disables at the ends", async () => {
    el.items = [{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }];
    await el.updateComplete;

    expect(rowButtons(el, 0).up.disabled).toBe(true);
    expect(rowButtons(el, 2).down.disabled).toBe(true);

    rowButtons(el, 1).up.click();

    const event = onItemsChanged.mock.calls[0]![0] as CustomEvent<{ items: Item[] }>;
    expect(event.detail.items).toEqual([{ name: "Bob" }, { name: "Alice" }, { name: "Carol" }]);
  });

  it("expands a row into an ha-form bound to that item's data", async () => {
    el.items = [{ name: "Alice" }];
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("ha-form")).toBeNull();

    rowButtons(el, 0).expand.click();
    await el.updateComplete;

    const form = el.shadowRoot!.querySelector("ha-form") as unknown as { data: Item; schema: HaFormSchema[] };
    expect(form).not.toBeNull();
    expect(form.data).toEqual({ name: "Alice" });
    expect(form.schema).toBe(schema);
  });

  it("emits items-changed with the row replaced when its ha-form fires value-changed", async () => {
    el.items = [{ name: "Alice" }];
    await el.updateComplete;
    rowButtons(el, 0).expand.click();
    await el.updateComplete;

    const form = el.shadowRoot!.querySelector("ha-form")!;
    form.dispatchEvent(
      new CustomEvent("value-changed", { detail: { value: { name: "Alicia" } }, bubbles: true, composed: true }),
    );

    const event = onItemsChanged.mock.calls[0]![0] as CustomEvent<{ items: Item[] }>;
    expect(event.detail.items).toEqual([{ name: "Alicia" }]);
  });

  describe("expanded-row tracking across reorder and removal", () => {
    // The expanded row is tracked by index, so any reorder or removal has to
    // move it with the item the user actually opened. Untested until now: the
    // branches where the expanded row is the *target* of a swap, or sits after
    // a removed row.
    it("follows its item when another row is moved onto it", async () => {
      el.items = [{ name: "a" }, { name: "b" }, { name: "c" }];
      await el.updateComplete;

      rowButtons(el, 2).expand.click(); // open "c" (index 2)
      await el.updateComplete;
      // Move "b" (index 1) down, so it swaps into index 2 and "c" lands at 1.
      rowButtons(el, 1).down.click();
      await el.updateComplete;

      const forms = el.shadowRoot!.querySelectorAll("ha-form");
      expect(forms).toHaveLength(1);
      expect((forms[0] as unknown as { data: Item }).data.name).toBe("c");
    });

    it("shifts down when a row before it is removed", async () => {
      el.items = [{ name: "a" }, { name: "b" }, { name: "c" }];
      await el.updateComplete;

      rowButtons(el, 2).expand.click(); // open "c"
      await el.updateComplete;
      rowButtons(el, 0).remove.click(); // drop "a" -> "c" moves to index 1
      await el.updateComplete;

      const forms = el.shadowRoot!.querySelectorAll("ha-form");
      expect(forms).toHaveLength(1);
      expect((forms[0] as unknown as { data: Item }).data.name).toBe("c");
    });

    it("closes when the expanded row itself is removed", async () => {
      el.items = [{ name: "a" }, { name: "b" }];
      await el.updateComplete;

      rowButtons(el, 1).expand.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("ha-form")).toHaveLength(1);

      rowButtons(el, 1).remove.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("ha-form")).toHaveLength(0);
    });
  });

  it("falls back to a positional summary when no computeRowSummary is given", async () => {
    el.items = [{ name: "a" }, { name: "b" }];
    await el.updateComplete;

    const summaries = [...el.shadowRoot!.querySelectorAll(".summary")].map((n) => n.textContent?.trim());
    expect(summaries).toEqual(["Item 1", "Item 2"]);
  });

  it("adds an empty item when no newItemDefaults is given", async () => {
    el.items = [];
    await el.updateComplete;

    (el.shadowRoot!.querySelector("button.add") as HTMLButtonElement).click();
    await el.updateComplete;

    expect(onItemsChanged).toHaveBeenCalled();
    const detail = onItemsChanged.mock.calls.at(-1)![0] as CustomEvent<{ items: Item[] }>;
    expect(detail.detail.items).toEqual([{}]);
  });

});
