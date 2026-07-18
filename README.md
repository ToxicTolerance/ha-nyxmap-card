# ha-nyxmap-card

A Home Assistant Lovelace custom card that renders a map using **MapLibre GL**
(vector tiles) instead of Leaflet. Forked in spirit from
[nathan-gs/ha-map-card](https://github.com/nathan-gs/ha-map-card) — the YAML
config surface stays close to upstream so dashboards migrate with minimal
changes, while the entire draw layer is swapped from Leaflet to MapLibre GL.

Status: early development, see `CLAUDE.md` for the phased implementation plan.

## Development

```
npm install
npm run dev        # Vite dev server against dev/harness.html with a mocked hass object
npm run build       # bundles dist/nyxmap-card.js (single ES module)
npm test            # vitest
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
```

## Installing in Home Assistant

### Via HACS (once a release exists)

1. HACS → Frontend → ⋮ menu → Custom repositories
2. Add `https://github.com/ToxicTolerance/ha-nyxmap-card`, category "Plugin"
3. Install "NyxMap Card", then add it as a Lovelace resource (HACS does this automatically for plugins)
4. Add a card with `type: custom:nyxmap-card`

Releases are cut by pushing a `v*` tag — `.github/workflows/release.yml` builds
`dist/nyxmap-card.js` and attaches it to a GitHub Release, which is what HACS
downloads (`filename` in `hacs.json` points at that asset).

### Manual

1. `npm run build`
2. Copy `dist/nyxmap-card.js` to `/config/www/nyxmap-card.js`
3. Add it as a Lovelace dashboard resource of type "JavaScript Module"
4. Add a card with `type: custom:nyxmap-card`
