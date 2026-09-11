// app/core/domains/recommendation/highest_capital_efficiency_strategy.class.ts

import {
  CAPITAL_EFFICIENCY_SCALE,
  SCORE_SCALE,
  capitalEfficiencyRatio,
} from '../../math';
import type { Pool } from '../pool';
import type { Position } from '../position';
import type { IRecommendationStrategy } from '../strategy';

/**
 * Highest-capital-efficiency recommendation strategy.
 *
 * Strategy: just rank by CE. The score is
 *
 *     score = min(ce, MAX_CE) / MAX_CE
 *
 * saturating at `MAX_CE` (default 5× V2-equivalent).
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

  /** CE factor saturates at 5× V2-equivalent (typical CL upper bound). */
  static readonly MAX_CE = 5n * CAPITAL_EFFICIENCY_SCALE;

  score(_pool: Pool, position: Position): bigint {
    const ce = capitalEfficiencyRatio(position.range.tickLower, position.range.tickUpper);

    if (ce <= 0n) {
      return 0n;
    }

    if (ce >= HighestCapitalEfficiencyStrategy.MAX_CE) {
      return SCORE_SCALE;
    }

    return (ce * SCORE_SCALE) / HighestCapitalEfficiencyStrategy.MAX_CE;
  }
}