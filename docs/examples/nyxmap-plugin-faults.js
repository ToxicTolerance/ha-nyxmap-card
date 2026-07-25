// A deliberately misbehaving plugin, used to demonstrate the card's fault
// isolation. Registered BEFORE the working one, so if isolation failed the
// working plugin's overlay and the card's own layers would both be lost.
window.nyxmapPlugins = window.nyxmapPlugins ?? [];

// (1) setup() throws outright.
window.nyxmapPlugins.push({
  setup() {
    throw new Error("demo: this plugin's setup() threw");
  },
});

// (2) claims an id inside a reserved built-in namespace - rejected, not
//     silently allowed to clobber the card's own circle overlays.
window.nyxmapPlugins.push({
  setup(ctx) {
    ctx.registerOverlay("circle-person.alice", {
      label: "Hijacked circle",
      source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      layers: [],
    });
  },
});

// (3) a control whose onAdd() throws.
window.nyxmapPlugins.push({
  setup(ctx) {
    ctx.registerControl({
      onAdd() {
        throw new Error("demo: this control's onAdd() threw");
      },
      onRemove() {},
    });
  },
});
