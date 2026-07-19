export interface BaseStyleEntry {
  label: string;
  styleLight: string;
  styleDark: string;
  /** Per-style zoom cap — see MapConfig.NamedMapStyle. Unset falls back to
   * the card-level max_zoom/min_zoom (and ultimately MapLibre's own 0–22
   * defaults) when this style becomes active. */
  maxZoom?: number;
  minZoom?: number;
}

export interface OverlayEntry {
  label: string;
  group?: string;
  setVisible(map: unknown, visible: boolean): void;
}

/**
 * Backs the layer switcher UI (LayerSwitcherControl): a radio group over
 * registered base map styles and a checkbox group over registered overlays.
 * Deliberately non-reactive — NyxmapCard (the Lit layer) owns which base
 * style is selected and which overlays are visible as @state, and re-renders
 * the switcher from snapshots of this registry; this class is just data.
 */
export class LayerRegistry {
  private readonly baseStyles = new Map<string, BaseStyleEntry>();
  private readonly overlays = new Map<string, OverlayEntry>();

  registerBaseStyle(id: string, entry: BaseStyleEntry): void {
    this.baseStyles.set(id, entry);
  }

  registerOverlay(id: string, entry: OverlayEntry): void {
    this.overlays.set(id, entry);
  }

  /** Removes an id from whichever registry (base style or overlay) it's in. */
  unregister(id: string): void {
    this.baseStyles.delete(id);
    this.overlays.delete(id);
  }

  getBaseStyles(): ReadonlyMap<string, BaseStyleEntry> {
    return this.baseStyles;
  }

  getOverlays(): ReadonlyMap<string, OverlayEntry> {
    return this.overlays;
  }
}
