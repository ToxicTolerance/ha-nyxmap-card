import "./components/NyxmapCard";

declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: "nyxmap-card",
  name: "NyxMap Card",
  description: "MapLibre GL vector-tile map card for Home Assistant",
});
