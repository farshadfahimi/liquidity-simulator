// app/core/domains/strategy/strategy.interface.ts

import type { Pool } from '../pool';
import type { Position } from '../position';

/**
 * Optional, range-specific context handed to a strategy when the
 * caller knows something about the *pool* (TVL roadmap slice 4).
 *
 * The context is the payoff of the TVL slices: instead of a single
 * flat "expected APR" prior for every candidate, a strategy can see
 * what the pool actually earns and how likely the candidate range is
 * to stay in range over the holding horizon:
 *
 *     expectedApr = poolFeeApr × capitalEfficiency × P(in range)
 *
 * A strategy that doesn't care about APR (pure CE rankers) simply
 * ignores the context — it stays optional, so the interface is
 * backward compatible with every strategy written before slice 4.
 *
 * Scale conventions:
 *   - `expectedApr`, `poolFeeApr` — at `APR_SCALE` (1e18 == 100%/yr).
 *   - `tvlUsd` — at `USD_DECIMALS` (6), so `1_000_000n` == `$1.00`.
 *     `0n` means "TVL unknown".
 *   - `inRangeProbability` — at `SCORE_SCALE` (1e18 == 1.0), i.e.
 *     `2Φ(k) − 1` for the candidate's z-score `k`.
 */
export interface IStrategyContext {
  /**
   * Range-specific expected fee APR at `APR_SCALE` (1e18 == 100%/yr).
   */
  readonly expectedApr: bigint;

  /**
   * Pool-level fee APR (before the range adjustments), at `APR_SCALE`.
   * `0n` = unknown.
   */
  readonly poolFeeApr: bigint;

  /**
   * Pool TVL, USD at `USD_DECIMALS` (6). `0n` = unknown.
   */
  readonly tvlUsd: bigint;

  /**
   * Probability that the candidate range is still in range at the end
   * of the holding horizon, at `SCORE_SCALE` (1e18 == 1.0).
   */
  readonly inRangeProbability: bigint;
}

/**
 * Behavior contract for a recommendation "strategy". A strategy scores
 * candidate positions and (optionally) ranks them.
 *
 * For Phase 3 we ship the interface only — concrete strategies
 * (Balanced, Maximum Fee, Lowest Risk, ...) are implemented in
 * Phase 6 alongside the recommendation engine.
 */
export interface IRecommendationStrategy {
  readonly id: string;

  readonly name: string;

  /**
   * Score a single candidate position against the current pool state.
   * Returns a unitless score in `[0, 1e18]` where larger means better.
   * `0n` means "skip".
   *
   * `context` is optional and only supplied when the caller has a
   * liquidity snapshot for the pool (TVL roadmap slice 4). Strategies
   * that predate it must keep working when it is absent.
   */
  score(pool: Pool, position: Position, context?: IStrategyContext): bigint;
}
