// Runnable example of the nyxmap-card plugin hook. Open dev/plugin-example.html
// (npm run dev, then browse to /dev/plugin-example.html) to see it live.
//
// It demonstrates all three things a real MapLibre-ecosystem plugin needs:
//   1. injectStyle()  — put the plugin's CSS inside the card's shadow root, or
//                        the control attaches but renders invisibly (0×0).
//   2. map.addControl — attach the IControl (here: maplibre-compass-pro).
//   3. registerOverlay — a custom source + layers that shows up in the layer
//                        switcher and survives theme swaps.
import "../src/components/NyxmapCard";
import type { NyxmapCard } from "../src/components/NyxmapCard";
import { createMockHass } from "./mock-hass";

window.nyxmapPlugins = window.nyxmapPlugins ?? [];
window.nyxmapPlugins.push({
  setup(ctx) {
    // (1) + (2): a real ecosystem plugin loaded from a CDN, exactly as a HA
    // dashboard author would from a JS-module resource.
    ctx.injectStyle("https://esm.sh/maplibre-compass-pro/dist/style.css");
    // @ts-expect-error - remote ESM loaded at runtime from a CDN; no local types
    import(/* @vite-ignore */ "https://esm.sh/maplibre-compass-pro")
      .then((mod) => {
        const Compass = mod.Compass ?? mod.default?.Compass ?? mod.default;
        ctx.map.addControl(new Compass({ size: "lg", displayDirections: true }), "bottom-left");
      })
      .catch((e) => console.error("compass load failed", e));

    // (3): a custom overlay — appears as a toggle in the layer switcher and is
    // replayed after every theme swap.
    ctx.registerOverlay("plugin:ring", {
      label: "Demo ring",
      group: "plugins",
      source: {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [13.4, 52.52] } },
      },
      layers: [
        {
          id: "plugin:ring-circle",
          type: "circle",
          source: "plugin:ring",
          paint: {
            "circle-radius": 40,
            "circle-color": "#00e5ff",
            "circle-opacity": 0.15,
            "circle-stroke-color": "#00e5ff",
            "circle-stroke-width": 2,
          },
        },
      ],
    });
  },
});

const card = document.createElement("nyxmap-card") as NyxmapCard;
card.setConfig({
  title: "Plugin example (compass + overlay)",
  x: 13.4,
  y: 52.52,
  zoom: 11,
  height: 600,
  layer_switcher: true,
  entities: ["person.demo_alice"],
});
card.hass = createMockHass();
document.getElementById("app")!.appendChild(card);
