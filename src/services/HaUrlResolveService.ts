import type { HomeAssistant } from "../types/home-assistant";

const STATES_TOKEN = /\{\{\s*states\(['"]([^'"]+)['"]\)\s*\}\}/g;

/**
 * Resolves `{{ states('entity_id') }}` templating in tile/WMS layer URLs.
 * Simpler than upstream ha-map-card's HaUrlResolveService, which maintains
 * its own live entity-subscription cache (HaLinkedEntityService) to push
 * updates into Leaflet layers imperatively — this fork's render services are
 * already re-invoked on every `hass` change (see NyxmapCard), so re-resolving
 * from the current `hass` snapshot on each call is sufficient and needs no
 * subscription bookkeeping of its own.
 */
export class HaUrlResolveService {
  constructor(private readonly hass: HomeAssistant) {}

  resolveUrl(url: string): string {
    return url.replace(STATES_TOKEN, (_match, entityId: string) => this.hass.states[entityId]?.state ?? "");
  }
}
