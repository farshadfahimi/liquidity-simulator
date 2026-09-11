// app/core/domains/recommendation/lowest_risk_strategy.class.ts

import {
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
 * Options for {@link LowestRiskStrategy}.
 *
 * `entryPrice` — the price the user is presumed to be entering at.
 * Used for the IL penalty term. Typically `pool.currentPrice(18)`.
 *
 * Strategy: the user wants the *widest, lowest-IL, most-likely-to-be
 * in-range* range. We penalize CE (tighter == riskier) and penalize
 * IL at the current price. APR is ignored — risk-only.
 *
 *     score = (1 − ceFactor) × (1 + ilAtCurrentPrice)
 *
 * where:
 *   - `ceFactor = min(ce, MAX_CE) / MAX_CE` — saturates at MAX_CE.
 *   - `(1 + ilAtCurrentPrice)` is at `SCORE_SCALE`. `il ≤ 0`, so
 *     this is `≤ 1`. We floor at 0 so `il < −100%` zeroes the score.
 */
export interface ILowestRiskStrategyOptions {
  readonly entryPrice: Price;
}

/**
 * Lowest-risk recommendation strategy.
 *
 * Use this when the user is more worried about IL / range exits than
 * about absolute APR — a "defensive" choice that pairs well with
 * {@link MaximumFeeStrategy} for the "aggressive vs defensive"
 * UI split.
 */
export class LowestRiskStrategy implements IRecommendationStrategy {
  readonly id = 'lowest-risk';

  readonly name = 'Lowest Risk';

  readonly entryPrice: Price;

  /** CE factor saturates at 5× V2-equivalent (typical CL upper bound). */
  static readonly MAX_CE = 5n * CAPITAL_EFFICIENCY_SCALE;

  constructor(options: ILowestRiskStrategyOptions) {
    if (options.entryPrice.value <= 0n) {
      throw new Error(
        `LowestRiskStrategy entryPrice must be positive, got ${options.entryPrice.value}`,
      );
    }

    this.entryPrice = options.entryPrice;
  }

  score(pool: Pool, position: Position): bigint {
    const ce = capitalEfficiencyRatio(position.range.tickLower, position.range.tickUpper);

    if (ce <= 0n) {
      return 0n;
    }

    // (1 − ceFactor): wider ranges (low CE) score higher. The factor
    // saturates at MAX_CE; ranges tighter than MAX_CE get a 0 from
    // this term, which the multiplicative blend penalizes.
    const ceFactor = ce >= LowestRiskStrategy.MAX_CE
      ? SCORE_SCALE
      : (ce * SCORE_SCALE) / LowestRiskStrategy.MAX_CE;

    const oneMinusCeFactor = SCORE_SCALE - ceFactor;

    // IL factor at SCORE_SCALE = (1 + il) — il ≤ 0 so result ≤ 1.
    const il = ilBetweenPrices(
      pool.currentPrice(this.entryPrice.decimals).value,
      this.entryPrice.decimals,
      this.entryPrice.value,
      this.entryPrice.decimals,
      18,
    );

    const ilFactor = il <= -SCORE_SCALE ? 0n : SCORE_SCALE + il;

    if (ilFactor === 0n) {
      return 0n;
    }

    // Multiplicative blend at SCORE_SCALE² → divide by SCORE_SCALE.
    return (oneMinusCeFactor * ilFactor) / SCORE_SCALE;
  }
}