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
    const firstMarker = (service as unknown as { markers: Map<string, { marker: FakeMarker }> }).markers.get(
      "device_tracker.phone",
    )!.marker;

    entities[0] = EntityConfig.from({ entity: "device_tracker.phone", fixed_x: 3, fixed_y: 4 });
    service.update(entities, hass);
    const secondMarker = (service as unknown as { markers: Map<string, { marker: FakeMarker }> }).markers.get(
      "device_tracker.phone",
    )!.marker;

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

    const inner = (service as unknown as { markers: Map<string, { inner: HTMLElement }> }).markers.get(
      "device_tracker.phone",
    )!.inner;
    inner.dispatchEvent(new Event("click"));

    expect(onTap).toHaveBeenCalledWith("device_tracker.phone");
  });

  it("suppresses the marker for an entity whose geojson config sets hide_marker", () => {
    const service = new EntitiesRenderService(
      createFakeMaplibreMap() as never,
      createFakeMaplibreGl(),
      vi.fn(),
    );
    const cfg = EntityConfig.from({
      entity: "geo_location.demo",
      fixed_x: 1,
      fixed_y: 2,
      geojson: { attribute: "geo_shape", hide_marker: true },
    });

    service.update([cfg], hassWith({}));

    expect(service.has("geo_location.demo")).toBe(false);
  });

  it("detaches (but keeps tracking) a marker absorbed into a cluster, and reattaches it once released", () => {
    const service = new EntitiesRenderService(
      createFakeMaplibreMap() as never,
      createFakeMaplibreGl(),
      vi.fn(),
    );
    const cfg = EntityConfig.from({ entity: "device_tracker.phone", fixed_x: 1, fixed_y: 2 });
    const hass = hassWith({});
    // absorbed maps entity id → the bubble centroid it converges toward.
    const absorbed = new Map<string, [number, number]>([["device_tracker.phone", [5, 6]]]);

    service.update([cfg], hass);
    const tracked = (service as unknown as {
      markers: Map<string, { marker: FakeMarker; inner: HTMLElement }>;
    }).markers.get("device_tracker.phone")!;
    const { marker, inner } = tracked;
    expect(marker.remove).not.toHaveBeenCalled();

    // Absorbing now animates the marker converging in: remove() is deferred
    // until the transition completes (a transitionend we dispatch to force it).
    service.update([cfg], hass, absorbed);
    expect(marker.remove).not.toHaveBeenCalled();
    inner.dispatchEvent(new Event("transitionend"));
    expect(marker.remove).toHaveBeenCalledTimes(1);
    // Still tracked — an absorbed marker isn't the same as one dropped from config.
    expect(service.has("device_tracker.phone")).toBe(true);

    // A second update while still absorbed must not start another animation.
    service.update([cfg], hass, absorbed);
    inner.dispatchEvent(new Event("transitionend"));
    expect(marker.remove).toHaveBeenCalledTimes(1);

    // Released (no longer in the absorbed map) → reattached and emerges out.
    service.update([cfg], hass, new Map());
    const sameMarker = (service as unknown as {
      markers: Map<string, { marker: FakeMarker }>;
    }).markers.get("device_tracker.phone")!.marker;
    expect(sameMarker).toBe(marker);
    expect(marker.addTo).toHaveBeenCalledTimes(2); // once on creation, once on reattach
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
