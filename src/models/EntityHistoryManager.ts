import type { EntityConfig } from "../configs/EntityConfig";
import type { MapConfig } from "../configs/MapConfig";
import { colorFromString } from "../maplibre/MarkerFactory";
import { resolveTime } from "../util/HaMapUtilities";
import { EntityHistory } from "./EntityHistory";

export type HistoryFetcher = (
  entityId: string,
  start: Date,
  end: Date,
) => Promise<Array<[number, number]>>;

/** Resolves history_start/history_end (entity-level, falling back to
 * card-level) for every entity and fetches each one's path. Entities with no
 * resolvable history_start are skipped entirely — no card-level default
 * means "no history for this entity", matching upstream's opt-in model.
 *
 * Per-entity failures are isolated: the whole batch used to ride on one
 * `Promise.all`, so a single entity that HA can't serve history for (renamed,
 * removed, recorder-excluded) rejected the aggregate and *every* trail was
 * dropped — with the card's caller having no `.catch`, the only symptom was an
 * unhandled rejection in the console. One bad entity now degrades to "no trail
 * for that entity". */
export class EntityHistoryManager {
  async refresh(
    entities: EntityConfig[],
    mapConfig: MapConfig,
    fetchPath: HistoryFetcher,
    now: Date = new Date(),
  ): Promise<Map<string, EntityHistory>> {
    const result = new Map<string, EntityHistory>();

    await Promise.all(
      entities.map(async (ent) => {
        const startRaw = ent.historyStart ?? mapConfig.historyStart;
        if (!startRaw) return;
        const start = resolveTime(startRaw, now);
        if (!start) return;

        const endRaw = ent.historyEnd ?? mapConfig.historyEnd;
        const end = endRaw ? (resolveTime(endRaw, now) ?? now) : now;

        let coords: Array<[number, number]>;
        try {
          coords = await fetchPath(ent.id, start, end);
        } catch (err) {
          console.warn(`[nyxmap] history fetch failed for ${ent.id}; skipping its trail`, err);
          return;
        }
        const lineColor = ent.historyLineColor ?? colorFromString(ent.id);
        result.set(
          ent.id,
          new EntityHistory(ent.id, coords, lineColor, mapConfig.historyShowLines, mapConfig.historyShowDots),
        );
      }),
    );

    return result;
  }
}
