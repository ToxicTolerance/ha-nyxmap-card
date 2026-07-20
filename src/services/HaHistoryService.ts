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
      // false, not true: HA's history API only returns full attributes
      // (incl. latitude/longitude) for the *first and last* row when
      // minimal_response is set — every row in between is stripped down to
      // just {last_changed, state}. That's fine for the state-timeline UI
      // it was designed for, but for a GPS trail it means most points get
      // silently dropped, and a tracker that hasn't changed state at all in
      // the window can end up with 0-1 usable points — failing the
      // "at least 2 points" check in EntityHistory.hasPath and making the
      // whole trail (and its layer switcher entry) vanish.
      minimal_response: false,
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
