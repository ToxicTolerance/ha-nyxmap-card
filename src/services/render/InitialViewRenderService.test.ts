import { describe, expect, it, vi } from "vitest";
import { EntityConfig } from "../../configs/EntityConfig";
import { MapConfig } from "../../configs/MapConfig";
import type { HomeAssistant } from "../../types/home-assistant";
import type { BoundsLike } from "../../util/geo";
import { InitialViewRenderService, type MapViewLike } from "./InitialViewRenderService";

function hassWith(states: HomeAssistant["states"]): HomeAssistant {
  return { states, callWS: vi.fn(), language: "en" };
}

function fakeMap(bounds: BoundsLike = { west: 0, east: 0, south: 0, north: 0 }) {
  return {
    jumpTo: vi.fn(),
    fitBounds: vi.fn(),
    getBounds: vi.fn(() => bounds),
  } satisfies MapViewLike;
}

describe("InitialViewRenderService.getInitialCenter", () => {
  const service = new InitialViewRenderService();

  it("prefers explicit x/y over everything else", () => {
    const config = new MapConfig({ x: 1, y: 2, focus_entity: "device_tracker.phone" });
    const hass = hassWith({
      "device_tracker.phone": {
        entity_id: "device_tracker.phone",
        state: "home",
        last_changed: "",
        last_updated: "",
        attributes: { latitude: 9, longitude: 9 },
      },
    });
    expect(service.getInitialCenter(config, hass)).toEqual([1, 2]);
  });

  it("falls back to the focus_entity's position when x/y are unset", () => {
    const config = new MapConfig({ focus_entity: "device_tracker.phone" });
    const hass = hassWith({
      "device_tracker.phone": {
        entity_id: "device_tracker.phone",
        state: "home",
        last_changed: "",
        last_updated: "",
        attributes: { latitude: 5, longitude: 6 },
      },
    });
    expect(service.getInitialCenter(config, hass)).toEqual([6, 5]);
  });

  it("returns null when focus_entity is set but unresolvable", () => {
    const config = new MapConfig({ focus_entity: "device_tracker.missing" });
    expect(service.getInitialCenter(config, hassWith({}))).toBeNull();
  });

  it("returns null when focus_entity is set but hass isn't available yet", () => {
    const config = new MapConfig({ focus_entity: "device_tracker.phone" });
    expect(service.getInitialCenter(config, undefined)).toBeNull();
  });

  it("returns null when neither x/y nor focus_entity are set", () => {
    expect(service.getInitialCenter(new MapConfig({}), hassWith({}))).toBeNull();
  });
});

describe("InitialViewRenderService.fitAllEntities", () => {
  const service = new InitialViewRenderService();

  it("fits bounds over focus_on_fit entities with resolvable positions", () => {
    const map = fakeMap();
    const entities = [
      EntityConfig.from({ entity: "a", fixed_x: 0, fixed_y: 0 }),
      EntityConfig.from({ entity: "b", fixed_x: 10, fixed_y: 10 }),
    ];
    service.fitAllEntities(map, entities, hassWith({}));
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it("excludes entities with focus_on_fit: false", () => {
    const map = fakeMap();
    const entities = [
      EntityConfig.from({ entity: "a", fixed_x: 0, fixed_y: 0 }),
      EntityConfig.from({ entity: "b", fixed_x: 1, fixed_y: 1 }),
      EntityConfig.from({ entity: "c", fixed_x: 999, fixed_y: 999, focus_on_fit: false }),
    ];
    service.fitAllEntities(map, entities, hassWith({}));
    const [sw, ne] = map.fitBounds.mock.calls[0]![0];
    // Only "a"/"b" (at [0, 0] and [1, 1]) should count — bounds stay near
    // zero instead of stretching out to the excluded entity at [999, 999].
    expect(sw[0]).toBeCloseTo(-0.1);
    expect(ne[0]).toBeCloseTo(1.1);
  });

  it("does nothing when no entity has a resolvable position", () => {
    const map = fakeMap();
    service.fitAllEntities(map, [EntityConfig.from("device_tracker.phone")], hassWith({}));
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("centers a single entity at the given zoom instead of fitting a zero-area box", () => {
    // Regression: padBounds() scales by the box's own width/height, so one
    // point stays a zero-area box; fitBounds() on that clamps to the map's
    // maxZoom, slamming the camera to building level. This is the most common
    // possible config (one entity, no x/y/focus_entity — what buildStubConfig
    // produces), so the default card used to land at z22 rather than z12.
    const map = fakeMap();
    const service = new InitialViewRenderService();
    service.fitAllEntities(map, [EntityConfig.from({ entity: "a", fixed_x: 1, fixed_y: 2 })], hassWith({}), 12);

    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.jumpTo).toHaveBeenCalledWith({ center: [1, 2], zoom: 12 });
  });

  it("treats several entities sharing one position as a single point too", () => {
    const map = fakeMap();
    const service = new InitialViewRenderService();
    service.fitAllEntities(
      map,
      [
        EntityConfig.from({ entity: "a", fixed_x: 4, fixed_y: 5 }),
        EntityConfig.from({ entity: "b", fixed_x: 4, fixed_y: 5 }),
      ],
      hassWith({}),
      9,
    );

    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.jumpTo).toHaveBeenCalledWith({ center: [4, 5], zoom: 9 });
  });
});

describe("InitialViewRenderService.updateFit", () => {
  const entities = [
    EntityConfig.from({ entity: "a", fixed_x: 5, fixed_y: 5 }),
    EntityConfig.from({ entity: "b", fixed_x: 6, fixed_y: 6 }),
  ];

  function movingEntityHass(lng: number, lat: number): HomeAssistant {
    return hassWith({
      "device_tracker.phone": {
        entity_id: "device_tracker.phone",
        state: "not_home",
        last_changed: "",
        last_updated: "",
        attributes: { latitude: lat, longitude: lng },
      },
      "device_tracker.other": {
        entity_id: "device_tracker.other",
        state: "not_home",
        last_changed: "",
        last_updated: "",
        attributes: { latitude: 1, longitude: 1 },
      },
    });
  }
  const movingEntities = [
    EntityConfig.from("device_tracker.phone"),
    EntityConfig.from("device_tracker.other"),
  ];

  it("never fits when focus_follow is 'none'", () => {
    const map = fakeMap();
    new InitialViewRenderService().updateFit(map, entities, hassWith({}), "none");
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.getBounds).not.toHaveBeenCalled();
  });

  it("fits when focus_follow is 'refocus'", () => {
    const map = fakeMap();
    new InitialViewRenderService().updateFit(map, entities, hassWith({}), "refocus");
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it("'refocus' does not re-fit while the tracked entities stay put", () => {
    // Regression: the card's updated() gate is `changed.has("hass")`, and HA
    // hands out a fresh hass object on every state change anywhere in the
    // instance — many per second. Re-fitting unconditionally pinned the
    // camera: any pan/zoom gesture was undone milliseconds later by an
    // unrelated sensor update.
    const map = fakeMap();
    const service = new InitialViewRenderService();
    service.updateFit(map, movingEntities, movingEntityHass(5, 5), "refocus");
    service.updateFit(map, movingEntities, movingEntityHass(5, 5), "refocus");
    service.updateFit(map, movingEntities, movingEntityHass(5, 5), "refocus");

    expect(map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it("'refocus' fits again once a tracked entity has actually moved", () => {
    const map = fakeMap();
    const service = new InitialViewRenderService();
    service.updateFit(map, movingEntities, movingEntityHass(5, 5), "refocus");
    service.updateFit(map, movingEntities, movingEntityHass(7, 7), "refocus");

    expect(map.fitBounds).toHaveBeenCalledTimes(2);
  });

  it("'contains' skips fitBounds when the current view already contains the target bounds", () => {
    const map = fakeMap({ west: -180, east: 180, south: -85, north: 85 });
    new InitialViewRenderService().updateFit(map, entities, hassWith({}), "contains");
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("'contains' fits when an entity has left the current view", () => {
    const map = fakeMap({ west: 0, east: 1, south: 0, north: 1 });
    new InitialViewRenderService().updateFit(map, entities, hassWith({}), "contains");
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
  });
});
