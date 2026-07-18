import type { HistoryDuringPeriodResult, HomeAssistant } from "../types/home-assistant";

/** Fetches entity position history via hass.callWS. Renderer-agnostic — this
 * has no MapLibre dependency, it just returns [[lng,lat], ...] ready to drop
 * into a GeoJSON LineString. */
export class HaHistoryService {
  constructor(private readonly hass: HomeAssistant) {}

  async fetchPath(entityId: string, start: Date, end: Date = new Date()): Promise<Array<[number, number]>> {
    const result = await this.hass.callWS<HistoryDuringPeriodResult>({
      type: "history/history_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entity_ids: [entityId],
      minimal_response: true,
      no_attributes: false,
    });

    const rows = result?.[entityId] ?? [];
    const coords: Array<[number, number]> = [];
    for (const row of rows) {
      const lat = row.a?.latitude;
      const lng = row.a?.longitude;
      if (Number.isFinite(lat) && Number.isFinite(lng)) coords.push([lng as number, lat as number]);
    }
    return coords;
  }
}
