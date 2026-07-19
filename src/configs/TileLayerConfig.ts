import { LayerConfig } from "./LayerConfig";

/** A card-level `tile_layers:` entry — `url` is an XYZ tile template
 * (`{z}/{x}/{y}`), rendered as a MapLibre raster source/layer. */
export class TileLayerConfig extends LayerConfig {}
