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

  // Regression: buildMarkerElement() was called only in the "no tracked
  // marker yet" branch, so a marker's DOM was built once and never refreshed —
  // a rotated /api/image_proxy/ token, a state-templated icon or a rename left
  // it frozen at first-render appearance until the whole card was rebuilt.
  describe("marker DOM stays current", () => {
    const cfg = () => EntityConfig.from("person.a");
    const hassPictured = (picture: string) =>
      hassWith({
        "person.a": {
          entity_id: "person.a",
          state: "home",
          last_changed: "",
          last_updated: "",
          attributes: { latitude: 1, longitude: 2, entity_picture: picture },
        },
      });

    function trackedOf(service: EntitiesRenderService) {
      return (service as unknown as { markers: Map<string, { inner: HTMLElement }> }).markers.get("person.a")!;
    }

    it("redraws the marker when entity_picture changes, reusing the same element", () => {
      const service = new EntitiesRenderService(createFakeMaplibreMap() as never, createFakeMaplibreGl(), vi.fn());
      service.update([cfg()], hassPictured("/api/image_proxy/x?tok=1"));
      const inner = trackedOf(service).inner;
      expect(inner.style.backgroundImage).toContain("tok=1");

      service.update([cfg()], hassPictured("/api/image_proxy/x?tok=2"));

      expect(trackedOf(service).inner).toBe(inner); // same node — listener/animation state kept
      expect(inner.style.backgroundImage).toContain("tok=2");
    });

    it("keeps the click handler working after a redraw", () => {
      const onTap = vi.fn();
      const service = new EntitiesRenderService(createFakeMaplibreMap() as never, createFakeMaplibreGl(), onTap);
      service.update([cfg()], hassPictured("/a.jpg"));
      service.update([cfg()], hassPictured("/b.jpg"));

      trackedOf(service).inner.dispatchEvent(new Event("click"));

      expect(onTap).toHaveBeenCalledWith("person.a");
    });

    it("does not touch the DOM for a position-only update", () => {
      const service = new EntitiesRenderService(createFakeMaplibreMap() as never, createFakeMaplibreGl(), vi.fn());
      const moved = (lat: number) =>
        hassWith({
          "person.a": {
            entity_id: "person.a",
            state: "home",
            last_changed: "",
            last_updated: "",
            attributes: { latitude: lat, longitude: 2, entity_picture: "/a.jpg" },
          },
        });
      service.update([cfg()], moved(1));
      const inner = trackedOf(service).inner;
      inner.dataset.sentinel = "untouched";

      service.update([cfg()], moved(9));

      // applyMarkerVisual() would not clear a data attribute, but it does
      // replaceChildren()/rewrite background-image — asserting the marker is
      // still the same node with the same picture is the observable proxy.
      expect(trackedOf(service).inner).toBe(inner);
      expect(inner.dataset.sentinel).toBe("untouched");
      expect(inner.style.backgroundImage).toContain("/a.jpg");
    });

    it("applies z_index_offset to the marker's positioning wrapper", () => {
      const gl = createFakeMaplibreGl();
      const service = new EntitiesRenderService(createFakeMaplibreMap() as never, gl, vi.fn());
      service.update([EntityConfig.from({ entity: "person.a", fixed_x: 1, fixed_y: 2, z_index_offset: 5 })], hassWith({}));

      const wrapper = (service as unknown as { markers: Map<string, { inner: HTMLElement }> }).markers.get("person.a")!
        .inner.parentElement!;
      expect(wrapper.className).toBe("nyxmap-marker-anchor");
      expect(wrapper.style.zIndex).toBe("5");
    });
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
