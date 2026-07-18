import type { EntityConfig } from "../configs/EntityConfig";
import type { HassEntity } from "../types/home-assistant";

export function initials(name: string): string {
  return name
    .split(/[\s_.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function colorFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${h % 360}, 60%, 45%)`;
}

/** Builds the marker DOM element: picture > icon > initials fallback chain. */
export function buildMarkerElement(entityCfg: EntityConfig, stateObj?: HassEntity): HTMLElement {
  const el = document.createElement("div");
  el.className = "nyxmap-marker";
  const size = entityCfg.size;
  el.style.width = el.style.height = `${size}px`;
  el.style.setProperty("--nyxmap-color", entityCfg.color ?? colorFromString(entityCfg.id));

  const picture = entityCfg.picture ?? stateObj?.attributes?.entity_picture;
  if (entityCfg.display !== "icon" && picture) {
    el.style.backgroundImage = `url("${picture}")`;
    el.classList.add("nyxmap-marker--picture");
  } else if (entityCfg.icon || stateObj?.attributes?.icon) {
    const ico = document.createElement("ha-icon");
    ico.setAttribute("icon", entityCfg.icon ?? stateObj!.attributes.icon!);
    el.appendChild(ico);
    el.classList.add("nyxmap-marker--icon");
  } else {
    el.textContent = entityCfg.label ?? initials(stateObj?.attributes?.friendly_name ?? entityCfg.id);
    el.classList.add("nyxmap-marker--initials");
  }
  return el;
}
