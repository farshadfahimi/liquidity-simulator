// app/core/domains/recommendation/highest_capital_efficiency_strategy.class.ts

import {
  CE_FACTOR_CEILING,
  capitalEfficiencyFactor,
  capitalEfficiencyRatio,
} from '../../math';
import type { Pool } from '../pool';
import type { Position } from '../position';
import type { IRecommendationStrategy } from '../strategy';

/**
 * Highest-capital-efficiency recommendation strategy.
 *
 * Strategy: rank by capital efficiency so the **tightest** range wins.
 * `capitalEfficiencyRatio` is the real CE (≈ 1× for a full range, ≈ 20×
 * for ±10%, ≈ 40× for ±5%), so the score is simply its log-normalised
 * value:
 *
 *     score = ln(ce) / ln(MAX_CE)       ∈ [0, 1]
 *
 * Tight ranges saturate at SCORE_SCALE (CE ≥ `MAX_CE`, 100×); a
 * (near) full-range span scores 0 and is skipped.
 *
 * This is intentionally trivial — a "pure CE" ranker is useful as
 * a sanity check and as the "I want the tightest range, period"
 * choice. APR, IL, and vol are all ignored.
 *
 * For "real" selection, use {@link BalancedStrategy} or
 * {@link MaximumFeeStrategy}.
 */
export class HighestCapitalEfficiencyStrategy implements IRecommendationStrategy {
  readonly id = 'highest-capital-efficiency';

  readonly name = 'Highest Capital Efficiency';

  /** CE factor saturates at 100× (≈ a ±1% range). */
  static readonly MAX_CE = CE_FACTOR_CEILING;

  score(pool: Pool, position: Position): bigint {
    const ce = capitalEfficiencyRatio(
      position.range.tickLower,
      position.range.tickUpper,
      pool.state.tick,
    );

    return capitalEfficiencyFactor(ce, HighestCapitalEfficiencyStrategy.MAX_CE);
  }
}