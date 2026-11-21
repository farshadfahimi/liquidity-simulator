// app/core/domains/recommendation/maximum_fee_strategy.class.ts

import {
  APR_SCALE,
  CE_FACTOR_CEILING,
  SCORE_SCALE,
  bigintSqrtFloor,
  capitalEfficiencyFactor,
  capitalEfficiencyRatio,
} from '../../math';
import type { Pool } from '../pool';
import type { Position } from '../position';
import type { IRecommendationStrategy, IStrategyContext } from '../strategy';

/**
 * Options for {@link MaximumFeeStrategy}.
 *
 * `expectedApr` — strategy's prior on APR for the candidate (same
 * convention as the others: historical-replay fed or scoring-config
 * `targetApr`).
 *
 * Strategy: a tighter range (higher CE) earns more fees per unit of
 * liquidity, so the strategy rewards APR directly *and* rewards
 * higher CE (log-scaled, capped at `MAX_CE`). The composite is:
 *
 *     score = (aprFactor × ceFactor)^0.5
 *
 * — a *geometric* mean so neither factor alone can win. A candidate
 * with great APR but low CE won't beat a balanced one. A candidate
 * with great CE but 0 APR won't either.
 */
export interface IMaximumFeeStrategyOptions {
  readonly expectedApr: bigint;
}

/**
 * Maximum-fee recommendation strategy.
 *
 * Use this when the user wants the *raw* APR-maximizing range.
 * Caveats: tight ranges tend to mean more IL risk and lower
 * probability of being in-range, so this strategy alone is
 * aggressive. Pair with {@link LowestRiskStrategy} for the
 * "aggressive vs defensive" UI split.
 */
export class MaximumFeeStrategy implements IRecommendationStrategy {
  readonly id = 'maximum-fee';

  readonly name = 'Maximum Fee';

  readonly expectedApr: bigint;

  /** APR factor saturates at 200%/year (a "very aggressive" target). */
  static readonly APR_FACTOR_CAP = 2n * APR_SCALE;

  /** CE factor saturates at 100× (≈ a ±1% range). */
  static readonly MAX_CE = CE_FACTOR_CEILING;

  constructor(options: IMaximumFeeStrategyOptions) {
    if (options.expectedApr < 0n) {
      throw new Error(
        `MaximumFeeStrategy expectedApr must be non-negative, got ${options.expectedApr}`,
      );
    }

    this.expectedApr = options.expectedApr;
  }

  score(pool: Pool, position: Position, context?: IStrategyContext): bigint {
    const ce = capitalEfficiencyRatio(
      position.range.tickLower,
      position.range.tickUpper,
      pool.state.tick,
    );

    // APR: the range-specific expectation when the caller supplied a
    // pool context (TVL roadmap slice 4), else the strategy's prior.
    const apr = context?.expectedApr ?? this.expectedApr;

    // APR factor.
    const aprFactor = apr >= MaximumFeeStrategy.APR_FACTOR_CAP
      ? SCORE_SCALE
      : (apr * SCORE_SCALE) / MaximumFeeStrategy.APR_FACTOR_CAP;

    if (aprFactor === 0n) {
      return 0n;
    }

    // CE factor: log-normalised; 0 for a (near) full-range span.
    const ceFactor = capitalEfficiencyFactor(ce, MaximumFeeStrategy.MAX_CE);

    if (ceFactor === 0n) {
      return 0n;
    }

    // Geometric mean of two SCORE_SCALE-precision factors. The
    // product is at SCORE_SCALE² precision; bigintSqrtFloor pulls
    // it back. Result is again at SCORE_SCALE.
    const product = aprFactor * ceFactor;
    return bigintSqrtFloor(product);
  }
}