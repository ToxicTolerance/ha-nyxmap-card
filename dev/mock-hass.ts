import type { HomeAssistant } from "../src/types/home-assistant";

export function createMockHass(): HomeAssistant {
  return {
    language: "en",
    callWS: async () => {
      throw new Error("mock-hass: callWS is not implemented in the dev harness");
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
