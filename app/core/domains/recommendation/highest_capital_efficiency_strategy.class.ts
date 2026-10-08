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
 * Strategy: rank by inverse-CE so the **tightest** range wins. The
 * `capitalEfficiencyRatio` helper returns `P_upper / P_lower` (a
 * "V2-equivalent multiplier" — wider ranges get a higher number,
 * up to `1.0001^MAX_WIDTH`). To match the user-facing promise of
 * "highest capital efficiency" (i.e. tightest range that still has
 * meaningful capital efficiency), we invert the factor:
 *
 *     ceFactor    = min(ce, MAX_CE) / MAX_CE       ∈ [0, 1]
 *     score       = (SCORE_SCALE − ceFactor) ...   high for tight
 *                   … so wide ranges saturate at 0 and tight
 *                   ranges saturate at SCORE_SCALE.
 *
 * Note: ranges whose CE exceeds `MAX_CE` (default 5× V2-equivalent)
 * are treated as "too wide to be a real concentrated position"
 * and get a score of 0. This excludes the full V2-like spans
 * (e.g. a 1M-tick range that produces absurd price bounds).
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

    // ceFactor: 0 for tight range (CE=1), 1 for wide range (CE >= MAX_CE).
    const ceFactor = ce >= HighestCapitalEfficiencyStrategy.MAX_CE
      ? SCORE_SCALE
      : (ce * SCORE_SCALE) / HighestCapitalEfficiencyStrategy.MAX_CE;

    // Invert: tight range → high score, wide range → 0.
    return SCORE_SCALE - ceFactor;
  }
}