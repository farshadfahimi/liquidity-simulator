// app/core/domains/recommendation/balanced_strategy.class.ts

import {
  APR_SCALE,
  CAPITAL_EFFICIENCY_SCALE,
  SCORE_SCALE,
  capitalEfficiencyRatio,
  ilBetweenPrices,
} from '../../math';
import type { Price } from '../../shared/value_objects';
import type { Pool } from '../pool';
import type { Position } from '../position';
import type { IRecommendationStrategy } from '../strategy';

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
 * Used for the IL penalty term. Typically `pool.currentPrice(18)`.
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
 *   - `ceFactor = min(ce, MAX_CE) / MAX_CE` — normalized CE.
 *   - `ilFactor = 1 + il / SCORE_SCALE` — IL is `≤ 0`, so this is
 *     `≤ 1.0`. A `−2% IL` candidate has ilFactor `≈ 0.98`. We floor
 *     at `0` so that `IL < −100%` zeroes the score.
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

  /** CE factor saturates at 5× V2-equivalent (typical max for CL). */
  static readonly MAX_CE = 5n * CAPITAL_EFFICIENCY_SCALE;

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

  score(pool: Pool, position: Position): bigint {
    // CE factor: clamp CE ∈ [0, MAX_CE], normalize.
    const ce = capitalEfficiencyRatio(position.range.tickLower, position.range.tickUpper);

    if (ce <= 0n) {
      return 0n;
    }

    const ceFactor = ce >= BalancedStrategy.MAX_CE
      ? SCORE_SCALE
      : (ce * SCORE_SCALE) / BalancedStrategy.MAX_CE;

    // APR factor: clamp APR ∈ [0, 100%].
    const excessApr = this.expectedApr - this.riskFreeApr;

    if (excessApr <= 0n) {
      return 0n;
    }

    const aprFactor = excessApr >= BalancedStrategy.APR_FACTOR_CAP
      ? SCORE_SCALE
      : (excessApr * SCORE_SCALE) / BalancedStrategy.APR_FACTOR_CAP;

    // IL factor: compute IL at current price vs entry. ilFactor is
    // 1 + IL (where IL ≤ 0); floor at 0.
    const il = ilBetweenPrices(
      pool.currentPrice(this.entryPrice.decimals).value,
      this.entryPrice.decimals,
      this.entryPrice.value,
      this.entryPrice.decimals,
      18,
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