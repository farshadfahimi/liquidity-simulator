// app/core/domains/recommendation/volatility_adjusted_range_generator.class.ts

import { TickRange } from '../../shared/value_objects';
import { MAX_TICK, MIN_TICK } from '../../math';
import type { Pool } from '../pool';
import type { IRangeGenerator } from './range_generator.interface';

/**
 * Options for {@link VolatilityAdjustedRangeGenerator}.
 *
 * - `sigmaMultipliers` — list of multipliers for the per-day σ (in
 *   *tick units*) used to bracket the current tick symmetrically.
 *   E.g. `sigmaMultipliers = [1, 2, 4]` with `dailySigmaTicks = 500`
 *   emits ranges with half-widths `[500, 1000, 2000]` ticks around
 *   the current tick.
 * - `dailySigmaTicks` — observed per-day standard deviation of the
 *   price, expressed in *tick* units (ticks per day, real-valued, **not** an
 *   annualized figure). Derive it with `dailySigmaTicksFromSigmaPerSecond`
 *   / `blendedSigmaTicksPerSecond` (history) or
 *   `dailySigmaTicksFromAnnualVol` (an annualized vol) from
 *   `@core/math` — passing an annualized number here inflates the
 *   range ≈ 19×.
 * - `tickSpacing` override (optional). Defaults to the pool's
 *   `tickSpacing`.
 *
 * Output ranges are aligned to `tickSpacing`, clamped to the V3
 * envelope (`±887272`), and emitted as a {@link TickRange}.
 */
export interface IVolatilityAdjustedRangeGeneratorOptions {
  /** Per-day stdev of the price, in tick units (e.g. 500 = ±500 ticks). */
  readonly dailySigmaTicks: number;

  /** Multipliers applied to `dailySigmaTicks` for each candidate. */
  readonly sigmaMultipliers: readonly number[];

  /**
   * Optional tickSpacing override. Defaults to the pool's tickSpacing.
   * Useful when the caller pre-quotes at a different spacing than
   * the pool uses.
   */
  readonly tickSpacingOverride?: number;
}

/**
 * Volatility-adjusted symmetric range generator.
 *
 * For a pool with observed `dailySigmaTicks` daily volatility,
 * emitting ranges at `[1σ, 2σ, 4σ, ...]` boundaries gives
 * candidates that have a *roughly* predictable probability of being
 * in-range over a day. (The relationship isn't exact because V3
 * ranges are tick-aligned and σ is real-valued, but it's a
 * useful heuristic for "I want this position to remain in-range
 * about 68% of the time".)
 *
 * This is intentionally a thin extension over
 * {@link ConstantRangeGenerator}'s logic — the only difference is
 * that the per-candidate half-widths come from a *sigma-derived*
 * list instead of a hand-picked one.
 */
export class VolatilityAdjustedRangeGenerator implements IRangeGenerator {
  readonly id = 'volatility-adjusted-range';

  readonly dailySigmaTicks: number;

  readonly sigmaMultipliers: readonly number[];

  readonly tickSpacingOverride: number | undefined;

  constructor(options: IVolatilityAdjustedRangeGeneratorOptions) {
    // Real-valued on purpose: the half-width `mult · σ` is rounded to whole
    // ticks below, and forcing σ itself to an integer would distort
    // low-volatility (e.g. stable/stable) pools by tens of percent.
    if (!Number.isFinite(options.dailySigmaTicks) || options.dailySigmaTicks <= 0) {
      throw new Error(
        `VolatilityAdjustedRangeGenerator.dailySigmaTicks must be a positive finite number, `
        + `got ${options.dailySigmaTicks}`,
      );
    }

    if (options.sigmaMultipliers.length === 0) {
      throw new Error(
        'VolatilityAdjustedRangeGenerator requires at least one sigma multiplier',
      );
    }

    for (const m of options.sigmaMultipliers) {
      if (!Number.isFinite(m) || m <= 0) {
        throw new Error(
          `VolatilityAdjustedRangeGenerator.sigmaMultipliers must be positive finite numbers, got ${m}`,
        );
      }
    }

    if (options.tickSpacingOverride !== undefined) {
      if (!Number.isInteger(options.tickSpacingOverride) || options.tickSpacingOverride <= 0) {
        throw new Error(
          `VolatilityAdjustedRangeGenerator.tickSpacingOverride must be a positive integer, `
          + `got ${options.tickSpacingOverride}`,
        );
      }
    }

    this.dailySigmaTicks = options.dailySigmaTicks;
    this.sigmaMultipliers = [...options.sigmaMultipliers];
    this.tickSpacingOverride = options.tickSpacingOverride;
  }

  generate(pool: Pool): readonly TickRange[] {
    const tickSpacing = this.tickSpacingOverride ?? pool.state.tickSpacing;
    const currentTick = pool.state.tick;
    // Usable bounds: the V3 envelope rounded *inward* to a multiple of
    // tickSpacing. Clamping to the raw ±887272 yields ticks that are not
    // multiples of the spacing, which a real mint would reject.
    const minUsable = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
    const maxUsable = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;

    const result: TickRange[] = [];
    const seen = new Set<string>();
    for (const mult of this.sigmaMultipliers) {
      const halfWidth = Math.round(mult * this.dailySigmaTicks);
      let lower = currentTick - halfWidth;
      let upper = currentTick + halfWidth;

      // Align to spacing.
      lower = Math.floor(lower / tickSpacing) * tickSpacing;
      upper = Math.ceil(upper / tickSpacing) * tickSpacing;

      // Clamp to the spacing-aligned V3 envelope.
      lower = Math.max(minUsable, lower);
      upper = Math.min(maxUsable, upper);

      if (lower >= upper) {
        continue;
      }

      // Several multipliers can collapse onto the same aligned range
      // (tiny σ / large tickSpacing); emit each distinct range once.
      const key = `${lower}:${upper}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      result.push(new TickRange(lower, upper));
    }

    return result;
  }
}