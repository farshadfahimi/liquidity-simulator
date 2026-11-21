// app/core/domains/recommendation/balanced_strategy.class.ts

import {
  APR_SCALE,
  CE_FACTOR_CEILING,
  SCORE_SCALE,
  capitalEfficiencyFactor,
  capitalEfficiencyRatio,
  ilAtRangeEdges,
} from '../../math';
import type { Price } from '../../shared/value_objects';
import type { Pool } from '../pool';
import type { Position } from '../position';
import type { IRecommendationStrategy, IStrategyContext } from '../strategy';

/**
 * Options for {@link BalancedStrategy}.
 *
 * `expectedApr` — strategy's prior on APR. Either historical-replay
 * fed or `targetApr` from the scoring config.
 *
 * `annualizedVolatility` — realized vol (annualized). Same convention.
 *
 * `riskFreeApr` — subtracted from APR. Default 0.
 *
 * `entryPrice` — the price the user is presumed to be entering at.
 * Kept for API compatibility; the IL term no longer depends on it
 * (see {@link ilAtRangeEdges}: entry == current made IL identically 0).
 *
 * The strategy is the "default sensible LP choice": it rewards APR
 * and capital efficiency while penalizing IL. The exact shape is a
 * weighted geometric blend (multiplicative) so that a candidate
 * with zero APR or zero CE never wins (no single factor dominates).
 */
export interface IBalancedStrategyOptions {
  readonly expectedApr: bigint;

  readonly annualizedVolatility: bigint;

  readonly riskFreeApr?: bigint;

  readonly entryPrice: Price;
}

/**
 * Balanced LP strategy: a multiplicative composite of
 *
 *     score ∝ aprFactor × ceFactor × ilFactor
 *
 * where:
 *   - `aprFactor = (1 + apr / spy)^1` — soft APR contribution; we
 *     cap it at `1e18` so a candidate with apr ≥ 100% APR earns the
 *     full APR factor.
 *   - `ceFactor = ln(ce) / ln(MAX_CE)` — CE on a log scale; tight
 *     ranges (high CE) score high, a full-range span scores 0.
 *   - `ilFactor = 1 + il / SCORE_SCALE` — `il` is the stress IL at the
 *     worse range edge ({@link ilAtRangeEdges}), `≤ 0`, so this is
 *     `≤ 1.0`. A `−2% IL` candidate has ilFactor `≈ 0.98`. We floor
 *     at `0` so that `IL ≤ −100%` zeroes the score (absurdly wide
 *     ranges).
 *
 * Multiplicative blend keeps any "I have a great APR but my IL is
 * terrible" candidate from winning the ranking.
 */
export class BalancedStrategy implements IRecommendationStrategy {
  readonly id = 'balanced';

  readonly name = 'Balanced';

  readonly expectedApr: bigint;

  readonly annualizedVolatility: bigint;

  readonly riskFreeApr: bigint;

  readonly entryPrice: Price;

  /** APR factor saturates at 100%/year. */
  static readonly APR_FACTOR_CAP = APR_SCALE;

  /** CE factor saturates at 100× (≈ a ±1% range). */
  static readonly MAX_CE = CE_FACTOR_CEILING;

  constructor(options: IBalancedStrategyOptions) {
    if (options.expectedApr < 0n) {
      throw new Error(
        `BalancedStrategy expectedApr must be non-negative, got ${options.expectedApr}`,
      );
    }

    if (options.annualizedVolatility < 0n) {
      throw new Error(
        `BalancedStrategy annualizedVolatility must be non-negative, got ${options.annualizedVolatility}`,
      );
    }

    if (options.entryPrice.value <= 0n) {
      throw new Error(
        `BalancedStrategy entryPrice must be positive, got ${options.entryPrice.value}`,
      );
    }

    this.expectedApr = options.expectedApr;
    this.annualizedVolatility = options.annualizedVolatility;
    this.riskFreeApr = options.riskFreeApr ?? 0n;
    this.entryPrice = options.entryPrice;
  }

  score(pool: Pool, position: Position, context?: IStrategyContext): bigint {
    // CE factor: log-normalised capital efficiency at the pool's
    // current tick. 0 for a (near) full-range span.
    const ce = capitalEfficiencyRatio(
      position.range.tickLower,
      position.range.tickUpper,
      pool.state.tick,
    );
    const ceFactor = capitalEfficiencyFactor(ce, BalancedStrategy.MAX_CE);

    if (ceFactor === 0n) {
      return 0n;
    }

    // APR: the range-specific expectation when the caller supplied a
    // pool context (TVL roadmap slice 4), else the strategy's prior.
    const apr = context?.expectedApr ?? this.expectedApr;

    // APR factor: clamp APR ∈ [0, 100%].
    const excessApr = apr - this.riskFreeApr;

    if (excessApr <= 0n) {
      return 0n;
    }

    const aprFactor = excessApr >= BalancedStrategy.APR_FACTOR_CAP
      ? SCORE_SCALE
      : (excessApr * SCORE_SCALE) / BalancedStrategy.APR_FACTOR_CAP;

    // IL factor: stress IL at the worse range edge. (IL at the current
    // price vs the entry price is 0 whenever entry == current.)
    const il = ilAtRangeEdges(
      position.range.tickLower,
      position.range.tickUpper,
      pool.state.tick,
    );

    // ilFactor at SCORE_SCALE = (1 + il) at SCORE_SCALE precision.
    // il = -1e18 → ilFactor = 0; il = 0 → ilFactor = 1e18.
    const ilFactor = il <= -SCORE_SCALE ? 0n : SCORE_SCALE + il;

    if (ilFactor === 0n) {
      return 0n;
    }

    // Multiplicative blend. We work in `SCORE_SCALE`-precision ratios;
    // factor × factor returns `SCALE²`; divide once to land back at
    // SCORE_SCALE. With three factors, divide twice.
    const product = aprFactor * ceFactor * ilFactor;
    const scale = SCORE_SCALE * SCORE_SCALE;
    return product / scale;
  }
}