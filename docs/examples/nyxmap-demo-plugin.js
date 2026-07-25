// Demo nyxmap-card plugin, loaded as an ordinary Lovelace JavaScript-module
// resource. Exercises every part of NyxmapPluginContext:
//   getHass()        - seed the overlay from live Home Assistant state
//   registerOverlay  - a source + layers, listed in the layer switcher and
//                      replayed after every theme swap
//   injectStyle      - the plugin's own CSS, inside the card's shadow root
//   registerControl  - a custom IControl (the legend)
//   maplibregl       - the exact bundled module, used here for a Popup
const OVERLAY_ID = "plugin:coverage";

/** Sample points around every entity Home Assistant reports a position for. */
function coveragePoints(hass) {
  const features = [];
  for (const state of Object.values(hass?.states ?? {})) {
    const { latitude: lat, longitude: lon } = state.attributes ?? {};
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    for (let i = 0; i < 90; i++) {
      const r = Math.sqrt(Math.random()) * 0.085;
      const a = Math.random() * Math.PI * 2;
      features.push({
        type: "Feature",
        properties: { rssi: 0.35 + Math.random() * 0.65 },
        geometry: { type: "Point", coordinates: [lon + r * Math.cos(a) * 1.6, lat + r * Math.sin(a)] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

class LegendControl {
  onAdd() {
    const el = document.createElement("div");
    el.className = "maplibregl-ctrl nyx-demo-legend";
    el.innerHTML =
      '<strong>Signal coverage</strong>' +
      '<div class="nyx-demo-ramp"></div>' +
      '<div class="nyx-demo-scale"><span>weak</span><span>strong</span></div>';
    this._el = el;
    return el;
  }
  onRemove() {
    this._el?.remove();
  }
}

window.nyxmapPlugins = window.nyxmapPlugins ?? [];
window.nyxmapPlugins.push({
  setup(ctx) {
    // The card renders in a shadow root, so a plugin's CSS has to go in there
    // or its control attaches and renders invisibly.
    ctx.injectStyle(`
      .nyx-demo-legend {
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #212121);
        border-radius: 8px; padding: 10px 12px; margin: 8px;
        font: 500 12px/1.4 var(--paper-font-body1_-_font-family, sans-serif);
        box-shadow: 0 1px 4px rgba(0,0,0,.3); min-width: 148px;
      }
      .nyx-demo-ramp {
        height: 10px; margin: 8px 0 4px; border-radius: 5px;
        background: linear-gradient(90deg,#2b83ba,#abdda4,#ffffbf,#fdae61,#d7191c);
      }
      .nyx-demo-scale { display: flex; justify-content: space-between; opacity: .7; font-size: 11px; }
    `);

    ctx.registerOverlay(OVERLAY_ID, {
      label: "Signal coverage",
      group: "Demo plugin", // its own named section in the layer switcher
      source: { type: "geojson", data: coveragePoints(ctx.getHass()) },
      layers: [
        {
          id: OVERLAY_ID + "-heat",
          type: "heatmap",
          source: OVERLAY_ID,
          paint: {
            "heatmap-weight": ["get", "rssi"],
            "heatmap-intensity": 0.35,
            "heatmap-radius": 26,
            "heatmap-opacity": 0.75,
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(0,0,0,0)",
              0.2, "#2b83ba",
              0.4, "#abdda4",
              0.6, "#ffffbf",
              0.8, "#fdae61",
              1, "#d7191c",
            ],
          },
        },
      ],
    });

    ctx.registerControl(new LegendControl(), "bottom-left");

    // The bundled maplibregl module — the whole point of exposing it is that a
    // plugin script loaded separately cannot otherwise reach the card's copy.
    new ctx.maplibregl.Popup({ closeButton: false, closeOnClick: false })
      .setLngLat([13.405, 52.52])
      .setHTML("<b>Plugin popup</b><br>built with ctx.maplibregl")
      .addTo(ctx.map);
  },
});
