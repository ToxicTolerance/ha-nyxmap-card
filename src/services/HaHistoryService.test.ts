import { describe, expect, it, vi } from "vitest";
import type { HistoryDuringPeriodResult, HomeAssistant } from "../types/home-assistant";
import { HaHistoryService } from "./HaHistoryService";

function hassReturning(result: HistoryDuringPeriodResult): HomeAssistant {
  return {
    states: {},
    language: "en",
    callWS: vi.fn().mockResolvedValue(result),
  };
}

describe("HaHistoryService.fetchPath", () => {
  it("transforms rows with attributes into [lng, lat] pairs", async () => {
    const hass = hassReturning({
      "device_tracker.phone": [
        { a: { latitude: 1, longitude: 2 } },
        { a: { latitude: 3, longitude: 4 } },
      ],
    });
    const service = new HaHistoryService(hass);

    const coords = await service.fetchPath("device_tracker.phone", new Date("2026-01-01"));

    expect(coords).toEqual([
      [2, 1],
      [4, 3],
    ]);
  });

  it("skips rows missing lat/lng (minimal_response state-only rows)", async () => {
    const hass = hassReturning({
      "device_tracker.phone": [{ s: "not_home" }, { a: { latitude: 1, longitude: 2 } }, { a: {} }],
    });
    const service = new HaHistoryService(hass);

    const coords = await service.fetchPath("device_tracker.phone", new Date("2026-01-01"));

    expect(coords).toEqual([[2, 1]]);
  });

  it("returns an empty array when the entity has no history", async () => {
    const hass = hassReturning({});
    const service = new HaHistoryService(hass);

    const coords = await service.fetchPath("device_tracker.phone", new Date("2026-01-01"));

    expect(coords).toEqual([]);
  });

  it("sends the resolved start/end as ISO strings and the entity_id filter", async () => {
    const hass = hassReturning({});
    const service = new HaHistoryService(hass);
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-02T00:00:00.000Z");

    await service.fetchPath("device_tracker.phone", start, end);

    expect(hass.callWS).toHaveBeenCalledWith({
      type: "history/history_during_period",
      start_time: "2026-01-01T00:00:00.000Z",
      end_time: "2026-01-02T00:00:00.000Z",
      entity_ids: ["device_tracker.phone"],
      minimal_response: true,
      no_attributes: false,
    });
  });
});
