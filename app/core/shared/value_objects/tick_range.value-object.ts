// app/core/shared/value_objects/tick_range.value-object.ts

/**
 * Immutable, validated tick range. Range invariants:
 *   - `tickLower < tickUpper`
 *   - `tickLower >= MIN_TICK` and `tickUpper <= MAX_TICK`
 *     (V3 uses ±887272). Boundary checks here are defensive; pool
 *     adapters will normally auto-align.
 *
 * Tick alignment (`tickLower % tickSpacing === 0`) is **not** enforced
 * here — it is a property of the underlying pool, not of the range.
 * Adapters apply alignment via `nearestUsableTick` and pass the aligned
 * bounds into the domain.
 */
export class TickRange {
  readonly tickLower: number;

  readonly tickUpper: number;

  static readonly MIN_TICK = -887272;

  static readonly MAX_TICK = 887272;

  constructor(tickLower: number, tickUpper: number) {
    if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) {
      throw new Error(
        `TickRange bounds must be integers, got ${tickLower}, ${tickUpper}`,
      );
    }

    if (tickLower < TickRange.MIN_TICK || tickUpper > TickRange.MAX_TICK) {
      throw new Error(
        `TickRange out of bounds: [${tickLower}, ${tickUpper}] `
          + `must fit in [${TickRange.MIN_TICK}, ${TickRange.MAX_TICK}]`,
      );
    }

    if (tickLower >= tickUpper) {
      throw new Error(
        `TickRange lower must be < upper, got ${tickLower} >= ${tickUpper}`,
      );
    }

    this.tickLower = tickLower;
    this.tickUpper = tickUpper;
  }

  /** Width of the range in raw ticks (positive). */
  width(): number {
    return this.tickUpper - this.tickLower;
  }

  /**
   * Return a new TickRange expanded symmetrically by `ticks` on each
   * side, clamped to the V3 envelope.
   */
  expand(ticks: number): TickRange {
    const newLower = Math.max(TickRange.MIN_TICK, this.tickLower - ticks);
    const newUpper = Math.min(TickRange.MAX_TICK, this.tickUpper + ticks);

    return new TickRange(newLower, newUpper);
  }

  /**
   * Test whether the range contains `tick`. The lower bound is
   * inclusive, the upper bound is exclusive in V3 semantics, but for
   * domain modeling "contains" is the inclusive interpretation.
   */
  contains(tick: number): boolean {
    return tick >= this.tickLower && tick <= this.tickUpper;
  }

  /** Return ticks as a `[lower, upper]` tuple. */
  toTuple(): readonly [number, number] {
    return [this.tickLower, this.tickUpper];
  }
}
