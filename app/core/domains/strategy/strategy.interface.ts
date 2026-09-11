// app/core/domains/strategy/strategy.interface.ts

import type { Pool } from '../pool';
import type { Position } from '../position';

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
   */
  score(pool: Pool, position: Position): bigint;
}
