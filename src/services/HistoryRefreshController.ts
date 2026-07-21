import type { EntityHistory } from "../models/EntityHistory";

/** How often a card with history configured re-fetches its trails. History
 * used to be fetched exactly once per style load, so a long-lived dashboard
 * (`history_start: "5 hours ago"` on a wall panel) showed a trail frozen at
 * page-load time whose window drifted further out of date all day. A minute
 * is well under the resolution of any usable trail while staying far cheaper
 * than re-fetching per `hass` update — HA replaces the whole `hass` object on
 * every state change anywhere in the instance, which would mean many history
 * WebSocket round-trips per second. Not a config key: adding one means
 * touching MapConfig, which this deliberately doesn't own. */
export const HISTORY_REFRESH_MS = 60_000;

export interface HistoryRefreshDeps {
  /** Whether history is configured at all — a card with no `history_start`
   * anywhere never installs a timer. */
  hasHistoryConfigured(): boolean;
  /** Whether the map is in a state where overlays can be drawn. */
  isReady(): boolean;
  /** Fetch the current history window. Returning undefined means "not enough
   * context yet" (no config or no hass) and is not an error. */
  fetchHistories(): Promise<Map<string, EntityHistory>> | undefined;
  /** Called with a fetch result that is still the newest and still drawable. */
  onHistories(histories: Map<string, EntityHistory>): void;
}

/**
 * Owns the card's history polling: the timer, the in-flight guard, the
 * generation counter and the one-shot startup catch-up.
 *
 * Lifted out of NyxmapCard because none of it touches Lit, the DOM or
 * MapLibre — it is five fields and a promise chain that only needed fake
 * timers to test, but was reachable only through a jsdom mount plus a mocked
 * maplibregl module. It is also nyxmap-only (upstream ha-map-card has no
 * history *poll*), so extracting it does not cost fork diffability.
 */
export class HistoryRefreshController {
  private timer?: ReturnType<typeof setInterval>;
  /** Discards a response that is no longer the newest, which covers the two
   * ordering hazards this chain has always had: a response landing
   * mid-`setStyle()` (whose `update()` would call addSource() on an unloaded
   * style, which MapLibre throws on) and one landing after teardown. */
  private generation = 0;
  private inFlight = false;
  /** A refresh asked for while one was already running. The in-flight guard
   * used to just drop those, discarding the *reason* for the new call: editing
   * `history_start` mid-fetch left the old window on screen until the next
   * poll, up to a minute later. Now the request is remembered and re-fired
   * when the current fetch settles. */
  private refreshRequested = false;
  private catchUpDone = false;

  constructor(
    private readonly deps: HistoryRefreshDeps,
    private readonly intervalMs: number = HISTORY_REFRESH_MS,
  ) {}

  /** True until the first fetch has settled — the card's startup catch-up path
   * fires while this holds, for the case where hass wasn't set yet when the
   * first "style.load" ran. */
  get catchUpPending(): boolean {
    return !this.catchUpDone;
  }

  /** Re-arms the catch-up after a config change, so the new config is fetched
   * even if the first fetch already settled. */
  resetCatchUp(): void {
    this.catchUpDone = false;
  }

  refresh(): void {
    this.syncTimer();
    if (this.inFlight) {
      this.refreshRequested = true;
      return;
    }
    const pending = this.deps.fetchHistories();
    if (!pending) return;

    this.inFlight = true;
    const generation = ++this.generation;
    void pending
      .then((histories) => {
        if (generation !== this.generation || !this.deps.isReady()) return;
        this.deps.onHistories(histories);
      })
      .catch((err: unknown) => {
        console.warn("[nyxmap] history refresh failed", err);
      })
      .finally(() => {
        if (generation !== this.generation) return;
        this.inFlight = false;
        // Latched on *settle*, not before awaiting: latching it up front meant
        // a first fetch that failed could never be retried by the catch-up
        // path. (The poll is the real retry mechanism; this just stops the
        // catch-up from re-firing on every subsequent hass object.)
        this.catchUpDone = true;
        if (this.refreshRequested) {
          this.refreshRequested = false;
          this.refresh();
        }
      });
  }

  /** Starts/stops the periodic re-fetch to match the current config. */
  syncTimer(): void {
    const wanted = this.deps.hasHistoryConfigured();
    if (wanted && this.timer === undefined) {
      this.timer = setInterval(() => this.refresh(), this.intervalMs);
    } else if (!wanted && this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Teardown: stops the poll and invalidates any in-flight response. */
  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.generation++;
    this.inFlight = false;
    this.refreshRequested = false;
    this.catchUpDone = false;
  }
}
