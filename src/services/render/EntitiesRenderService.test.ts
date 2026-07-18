// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EntityConfig } from "../../configs/EntityConfig";
import type { HomeAssistant } from "../../types/home-assistant";
import {
  createFakeMaplibreGl,
  createFakeMaplibreMap,
  FakeMarker,
} from "../../../test/fakes/FakeMaplibreMap";
import { EntitiesRenderService } from "./EntitiesRenderService";

function hassWith(states: HomeAssistant["states"]): HomeAssistant {
  return { states, callWS: vi.fn(), language: "en" };
}

describe("EntitiesRenderService", () => {
  it("creates a marker for an entity resolvable from state lat/lng", () => {
    const map = createFakeMaplibreMap();
    const gl = createFakeMaplibreGl();
    const service = new EntitiesRenderService(map as never, gl, vi.fn());
    const entities = [EntityConfig.from("device_tracker.phone")];
    const hass = hassWith({
      "device_tracker.phone": {
        entity_id: "device_tracker.phone",
        state: "home",
        last_changed: "",
        last_updated: "",
        attributes: { latitude: 1, longitude: 2 },
      },
    });

    service.update(entities, hass);

    expect(service.has("device_tracker.phone")).toBe(true);
  });

  it("skips entities with no resolvable position", () => {
    const service = new EntitiesRenderService(
      createFakeMaplibreMap() as never,
      createFakeMaplibreGl(),
      vi.fn(),
    );
    const entities = [EntityConfig.from("device_tracker.phone")];
    const bounds = service.update(entities, hassWith({}));

    expect(service.has("device_tracker.phone")).toBe(false);
    expect(bounds).toBeNull();
  });

  it("moves an existing marker instead of recreating it", () => {
    const service = new EntitiesRenderService(
      createFakeMaplibreMap() as never,
      createFakeMaplibreGl(),
      vi.fn(),
    );
    const entities = [EntityConfig.from({ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 })];
    const hass = hassWith({});

    service.update(entities, hass);
    const firstMarker = (service as unknown as { markers: Map<string, FakeMarker> }).markers.get(
      "device_tracker.phone",
    )!;

    entities[0] = EntityConfig.from({ entity: "device_tracker.phone", fixed_x: 3, fixed_y: 4 });
    service.update(entities, hass);
    const secondMarker = (service as unknown as { markers: Map<string, FakeMarker> }).markers.get(
      "device_tracker.phone",
    )!;

    expect(secondMarker).toBe(firstMarker);
    expect(secondMarker.getLngLat()).toEqual([3, 4]);
  });

  it("removes a marker whose entity drops out of config", () => {
    const service = new EntitiesRenderService(
      createFakeMaplibreMap() as never,
      createFakeMaplibreGl(),
      vi.fn(),
    );
    const cfg = EntityConfig.from({ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 });
    const hass = hassWith({});

    service.update([cfg], hass);
    expect(service.has("device_tracker.phone")).toBe(true);

    service.update([], hass);
    expect(service.has("device_tracker.phone")).toBe(false);
  });

  it("invokes the tap handler with the entity id on marker click", () => {
    const onTap = vi.fn();
    const service = new EntitiesRenderService(
      createFakeMaplibreMap() as never,
      createFakeMaplibreGl(),
      onTap,
    );
    const cfg = EntityConfig.from({ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 });
    service.update([cfg], hassWith({}));

    const marker = (service as unknown as { markers: Map<string, FakeMarker> }).markers.get(
      "device_tracker.phone",
    )!;
    marker.element.dispatchEvent(new Event("click"));

    expect(onTap).toHaveBeenCalledWith("device_tracker.phone");
  });

  it("removeAll() removes every tracked marker", () => {
    const service = new EntitiesRenderService(
      createFakeMaplibreMap() as never,
      createFakeMaplibreGl(),
      vi.fn(),
    );
    service.update(
      [
        EntityConfig.from({ entity: "a", fixed_x: 1, fixed_y: 1 }),
        EntityConfig.from({ entity: "b", fixed_x: 2, fixed_y: 2 }),
      ],
      hassWith({}),
    );

    service.removeAll();

    expect(service.has("a")).toBe(false);
    expect(service.has("b")).toBe(false);
  });
});
