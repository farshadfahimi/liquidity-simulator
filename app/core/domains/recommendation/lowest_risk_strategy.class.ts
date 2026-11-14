// app/core/domains/recommendation/lowest_risk_strategy.class.ts

import {
  CE_FACTOR_CEILING,
  SCORE_SCALE,
  capitalEfficiencyFactor,
  capitalEfficiencyRatio,
  ilAtRangeEdges,
} from '../../math';
import type { Price } from '../../shared/value_objects';
import type { Pool } from '../pool';
import type { Position } from '../position';
import type { IRecommendationStrategy } from '../strategy';

/**
 * Options for {@link LowestRiskStrategy}.
 *
 * `entryPrice` — the price the user is presumed to be entering at.
 * Kept for API compatibility; the IL term no longer depends on it.
 *
 * Strategy: the user wants the *widest, lowest-IL, most-likely-to-be
 * in-range* range. We penalize CE (tighter == riskier) and penalize
 * the stress IL at the range edge. APR is ignored — risk-only.
 *
 *     score = (1 − ceFactor) × (1 + ilAtRangeEdges)
 *
 * where:
 *   - `ceFactor = ln(ce) / ln(MAX_CE)` — log-scaled, saturates at
 *     MAX_CE. Wide ranges (low CE) have a low `ceFactor`.
 *   - `(1 + ilAtRangeEdges)` is at `SCORE_SCALE`. `il ≤ 0`, so
 *     this is `≤ 1`. We floor at 0 so `il ≤ −100%` zeroes the score,
 *     which keeps absurdly wide ranges from winning.
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

  /** CE factor saturates at 100× (≈ a ±1% range). */
  static readonly MAX_CE = CE_FACTOR_CEILING;

  constructor(options: ILowestRiskStrategyOptions) {
    if (options.entryPrice.value <= 0n) {
      throw new Error(
        `LowestRiskStrategy entryPrice must be positive, got ${options.entryPrice.value}`,
      );
    }

    this.entryPrice = options.entryPrice;
  }

  score(pool: Pool, position: Position): bigint {
    const ce = capitalEfficiencyRatio(
      position.range.tickLower,
      position.range.tickUpper,
      pool.state.tick,
    );

    // (1 − ceFactor): wider ranges (low CE) score higher.
    const ceFactor = capitalEfficiencyFactor(ce, LowestRiskStrategy.MAX_CE);

    const oneMinusCeFactor = SCORE_SCALE - ceFactor;

    // IL factor at SCORE_SCALE = (1 + il) — stress IL at the worse
    // range edge; il ≤ 0 so the result ≤ 1.
    const il = ilAtRangeEdges(
      position.range.tickLower,
      position.range.tickUpper,
      pool.state.tick,
    );

    const ilFactor = il <= -SCORE_SCALE ? 0n : SCORE_SCALE + il;

    if (ilFactor === 0n) {
      return 0n;
    }

    // Multiplicative blend at SCORE_SCALE² → divide by SCORE_SCALE.
    return (oneMinusCeFactor * ilFactor) / SCORE_SCALE;
  }
}