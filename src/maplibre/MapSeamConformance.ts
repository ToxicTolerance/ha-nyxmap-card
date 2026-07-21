/**
 * Compile-time conformance guard for the `*Like` map seams.
 *
 * Every render service takes a deliberately narrow structural view of
 * `maplibregl.Map` (see each service's own `*Like` interface) so it can be
 * tested against a hand-rolled fake instead of a real WebGL context. Nothing
 * used to check that those views actually *describe* the real Map: NyxmapCard
 * handed the live map over behind `as unknown as ...`, which launders any
 * mismatch past the compiler. That is how `MapViewLike.getBounds()` came to
 * claim a plain `{west,east,south,north}` box while MapLibre returns a
 * `LngLatBounds` with accessor methods and no such properties — silently
 * breaking `focus_follow: "contains"`.
 *
 * The assertions below fail to compile if a seam ever drifts from the real
 * Map again. This module is **type-only**: it imports nothing at runtime,
 * exports no values, and emits no code, so it costs nothing in the bundle
 * (nothing imports it — `tsc --noEmit` still type-checks it because
 * tsconfig.json includes `src`).
 */
import type { Map as MaplibreMap, Source } from "maplibre-gl";
import type { ClusterMapLike } from "../services/render/ClusterRenderService";
import type { GeoJsonMapLike } from "../services/render/GeoJsonRenderService";
import type { MapSourceLike } from "../services/render/HistoryRenderService";
import type { MapViewLike } from "../services/render/InitialViewRenderService";
import type { TileLayersMapLike } from "../services/render/TileLayersRenderService";

/** Compiles only when `T` satisfies `Seam`. */
type Conforms<Seam, T extends Seam> = [Seam, T];

/**
 * The one narrowing the seams can't express directly: MapLibre declares
 * `getSource<TSource extends Source>(id): TSource | undefined`, whose type
 * parameter is constrained to `Source`, while the source-owning seams only
 * care about the one method they call (`setData` / `setTiles`). Every source
 * type those seams address (`GeoJSONSource`, `RasterTileSource`) *is* a
 * `Source`, so re-declaring just that member is a sound narrowing rather than
 * a licence to ignore the rest of the contract — which stays checked.
 */
type MapWithNarrowedGetSource<TSource> = Omit<MaplibreMap, "getSource"> & {
  getSource(id: string): TSource | undefined;
};

type _MapViewConforms = Conforms<MapViewLike, MaplibreMap>;
type _ClusterConforms = Conforms<ClusterMapLike, MaplibreMap>;
type _HistoryConforms = Conforms<
  MapSourceLike,
  MapWithNarrowedGetSource<Source & { setData(data: unknown): void }>
>;
type _GeoJsonConforms = Conforms<
  GeoJsonMapLike,
  MapWithNarrowedGetSource<Source & { setData(data: unknown): void }>
>;
type _TileLayersConforms = Conforms<
  TileLayersMapLike,
  MapWithNarrowedGetSource<Source & { setTiles(tiles: string[]): void }>
>;
