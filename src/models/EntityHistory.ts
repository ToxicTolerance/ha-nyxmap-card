export class EntityHistory {
  constructor(
    readonly entityId: string,
    readonly coordinates: Array<[number, number]>,
    readonly lineColor: string,
    readonly showLines: boolean = true,
    readonly showDots: boolean = false,
  ) {}

  /** A LineString needs at least two points to draw anything. */
  get hasPath(): boolean {
    return this.coordinates.length >= 2;
  }
}
