export class EntityHistory {
  constructor(
    readonly entityId: string,
    readonly coordinates: Array<[number, number]>,
    readonly lineColor: string,
    readonly showLines: boolean = true,
    readonly showDots: boolean = false,
  ) {}

  /**
   * Whether there is enough here to draw anything at all.
   *
   * A LineString needs two points, but a dot needs only one — so the minimum
   * depends on what this trail actually renders. With `history_show_lines:
   * false` + `history_show_dots: true`, a single recorded position is a
   * perfectly drawable dot; a flat `>= 2` dropped it, and dropped the overlay's
   * layer-switcher entry with it, so it read as "history is broken for this
   * entity" rather than "one sample so far".
   *
   * With lines on (the default) the answer is unchanged at 2, which is what
   * HaHistoryService's `minimal_response: false` comment is about.
   */
  get hasPath(): boolean {
    return this.coordinates.length >= (this.showDots ? 1 : 2);
  }
}
