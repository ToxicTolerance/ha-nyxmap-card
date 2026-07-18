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
 * means "no history for this entity", matching upstream's opt-in model. */
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

        const coords = await fetchPath(ent.id, start, end);
        const lineColor = ent.historyLineColor ?? colorFromString(ent.id);
        result.set(ent.id, new EntityHistory(ent.id, coords, lineColor));
      }),
    );

    return result;
  }
}
