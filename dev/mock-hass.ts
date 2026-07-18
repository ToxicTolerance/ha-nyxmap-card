import type { HistoryDuringPeriodResult, HomeAssistant } from "../src/types/home-assistant";

/** A little walk around Berlin so the history trail has something to draw. */
function demoHistoryFor(entityId: string): HistoryDuringPeriodResult {
  const base = entityId === "device_tracker.demo_phone" ? [52.52, 13.405] : [52.53, 13.39];
  const points = Array.from({ length: 8 }, (_, i) => ({
    a: {
      latitude: base[0]! + Math.sin(i / 2) * 0.01,
      longitude: base[1]! + Math.cos(i / 2) * 0.01,
    },
  }));
  return { [entityId]: points };
}

export function createMockHass(): HomeAssistant {
  return {
    language: "en",
    callWS: async (msg: Record<string, unknown>) => {
      if (msg.type === "history/history_during_period") {
        const entityId = (msg.entity_ids as string[])[0]!;
        return demoHistoryFor(entityId) as never;
      }
      throw new Error(`mock-hass: callWS type "${String(msg.type)}" is not implemented in the dev harness`);
    },
    states: {
      "device_tracker.demo_phone": {
        entity_id: "device_tracker.demo_phone",
        state: "home",
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        attributes: {
          friendly_name: "Demo Phone",
          latitude: 52.52,
          longitude: 13.405,
        },
      },
      "person.demo_alice": {
        entity_id: "person.demo_alice",
        state: "not_home",
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        attributes: {
          friendly_name: "Alice",
          latitude: 52.53,
          longitude: 13.39,
          icon: "mdi:account",
        },
      },
    },
  };
}
