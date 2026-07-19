import "../src/components/NyxmapCard";
import type { NyxmapCard } from "../src/components/NyxmapCard";
import { createMockHass } from "./mock-hass";

const card = document.createElement("nyxmap-card") as NyxmapCard;
card.setConfig({
  title: "NyxMap dev harness",
  x: 13.4,
  y: 52.52,
  zoom: 11,
  layer_switcher: true,
  entities: [
    {
      entity: "device_tracker.demo_phone",
      history_start: "5 hours ago",
      history_line_color: "#4287f5",
      circle: "auto",
    },
    "person.demo_alice",
  ],
});
card.hass = createMockHass();

document.getElementById("app")!.appendChild(card);

// Simulate HA pushing periodic state updates so marker-move behavior is
// visible without a real Home Assistant instance.
setInterval(() => {
  const hass = createMockHass();
  const phone = hass.states["device_tracker.demo_phone"]!;
  phone.attributes.latitude = 52.52 + (Math.random() - 0.5) * 0.01;
  phone.attributes.longitude = 13.405 + (Math.random() - 0.5) * 0.01;
  card.hass = hass;
}, 3000);
