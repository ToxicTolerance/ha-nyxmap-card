import { LayerConfig } from "./LayerConfig";

/** A card-level `wms:` entry — `url` is the WMS service endpoint (no query
 * string), `options` carries WMS GetMap params (`layers`, `format`,
 * `transparent`, `version`, `styles`); rendered as a MapLibre raster source
 * built around its `{bbox-epsg-3857}` tile-URL template token. */
export class WmsLayerConfig extends LayerConfig {}
