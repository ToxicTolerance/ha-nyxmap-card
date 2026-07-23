import type { EntityConfigRaw } from "../configs/EntityConfig";
import { formDataToEntityRaw } from "./EntityFormSchema";

/** A row as the list editor hands it back — form fields only. */
export type EntityFormRow = Record<string, unknown>;

/** Entity entries as they appear in raw YAML: either a bare id string or an
 * object. */
export type PreviousEntity = string | EntityConfigRaw;

function idOf(raw: PreviousEntity): string {
  return (typeof raw === "string" ? raw : raw.entity) || "";
}

/**
 * Matches each edited row back to its previous raw entity so the YAML-only
 * keys the visual form doesn't cover (`geojson`, a rich `circle:` object, …)
 * are carried across the edit rather than silently dropped.
 *
 * Two matching strategies, because neither is right on its own:
 *
 *  - **By entity id** for a reorder. Rows physically swap slots, so position
 *    would cross-wire one entity's geojson/circle onto whichever entity moved
 *    into its old slot.
 *  - **By position** for an in-place edit. If the edit *was* to the entity id
 *    itself (fixing a typo), an id lookup misses and falls back to an empty
 *    `{ entity: id }` — silently dropping every key outside the form schema.
 *    See code-review §14.
 *
 * They're told apart by the id multiset: the list editor's move buttons
 * permute ids without changing the set, while a rename changes it. Add and
 * remove change the length, which rules positional matching out entirely
 * (indices past the edit point have shifted) and leaves id matching — correct
 * there, since add/remove never rename.
 *
 * Lives here rather than in NyxmapCardEditor's `items-changed` handler because
 * it is the single trickiest decision in the editor, it has already produced
 * one defect (dropped keys on rename), and testing it from the element means
 * mounting a Lit component and dispatching an event for what is a pure
 * function of two arrays.
 */
export function reconcileEntityList(
  items: readonly EntityFormRow[],
  previousList: readonly PreviousEntity[],
): EntityConfigRaw[] {
  // One bucket per id, in list order, consumed (shift) once per match: a `set`
  // keyed by id collapses two rows sharing an entity id to the last occurrence,
  // so every same-id row in the by-id branch would resolve to that last entry
  // and the first row's YAML-only keys (e.g. a `geojson:` block) would be lost.
  const previousByEntityId = new Map<string, PreviousEntity[]>();
  for (const raw of previousList) {
    const id = idOf(raw);
    if (!id) continue;
    const bucket = previousByEntityId.get(id);
    if (bucket) bucket.push(raw);
    else previousByEntityId.set(id, [raw]);
  }

  const sameIds =
    items.length === previousList.length &&
    JSON.stringify(items.map((i) => (i.entity as string | undefined) ?? "").sort()) ===
      JSON.stringify(previousList.map(idOf).sort());
  const byPosition = items.length === previousList.length && !sameIds;

  return items.map((item, i) => {
    const id = item.entity as string | undefined;
    const previous = (byPosition ? previousList[i] : id ? previousByEntityId.get(id)?.shift() : undefined) ?? {
      entity: id ?? "",
    };
    return formDataToEntityRaw(item, previous);
  });
}
