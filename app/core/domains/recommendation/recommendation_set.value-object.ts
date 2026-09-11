// app/core/domains/recommendation/recommendation_set.value-object.ts

import type { TAddress } from '../../shared/types';
import { Recommendation } from './recommendation.value-object';

/**
 * Configuration that produced this set. The engine records enough
 * context that the UI can re-render the "why this ranked first?"
 * explanation without re-running the engine.
 */
export interface IRecommendationSetContext {
  /** Pool address (the pool the candidates were generated against). */
  readonly pool: TAddress;

  /** Chain id for `pool`. */
  readonly chainId: number;

  /** Strategy ids that participated in scoring (in input order). */
  readonly strategyIds: readonly string[];

  /** Human-readable pool description (e.g. "USDC/WETH 0.050%"). */
  readonly poolDescription: string;

  /**
   * Range-generator id that produced the candidate tick ranges. The
   * engine records this even though the {@link Recommendation.range}
   * carries the raw bounds — it's a hint for the UI to render the
   * candidate-generation strategy name.
   */
  readonly rangeGeneratorId: string;

  /** How many raw candidate ranges the engine started with. */
  readonly nCandidates: number;

  /** How many `Recommendation` objects ended up in `recommendations`. */
  readonly nRecommendations: number;

  /** How many got skipped (score = 0). */
  readonly nSkipped: number;
}

/**
 * Immutable, ranked recommendation set returned by the
 * {@link RecommendationEngine}. `recommendations` is sorted by score
 * descending — index `0` is the best candidate under the combined
 * scoring config the engine was given.
 *
 * The set is **immutable**. To re-rank (e.g. user changes principal),
 * call the engine again. Strategies are deterministic (they don't
 * pull IO), so re-running yields the same output.
 */
export class RecommendationSet {
  readonly context: IRecommendationSetContext;

  readonly recommendations: readonly Recommendation[];

  constructor(
    context: IRecommendationSetContext,
    recommendations: readonly Recommendation[],
  ) {
    // The engine already sorts, but we re-assert the invariant here
    // so callers can't bypass it by mutating inputs.
    for (let i = 1; i < recommendations.length; i++) {
      const prev = recommendations[i - 1]!.score;
      const curr = recommendations[i]!.score;

      if (curr > prev) {
        throw new Error(
          `RecommendationSet is not sorted descending by score at index ${i}: `
          + `prev=${prev} curr=${curr}`,
        );
      }
    }

    this.context = context;
    this.recommendations = recommendations;
  }

  /** Empty set guard. */
  isEmpty(): boolean {
    return this.recommendations.length === 0;
  }

  /** Top recommendation, or `undefined` if the set is empty. */
  top(): Recommendation | undefined {
    return this.recommendations[0];
  }

  /**
   * All recommendations belonging to a single strategy (in score
   * order). Useful for a UI that wants to render strategy-by-strategy
   * tabs.
   */
  byStrategy(strategyId: string): readonly Recommendation[] {
    return this.recommendations.filter((r) => r.strategyId === strategyId);
  }

  /**
   * Find the top recommendation across the entire set whose
   * `strategyId` matches. Useful for "give me the highest-ranked
   * BalancedStrategy candidate".
   */
  topForStrategy(
    strategyId: string,
  ): Recommendation | undefined {
    return this.byStrategy(strategyId)[0];
  }

  /**
   * Filter by strategy id *and* a minimum score. Strategies can
   * optionally return `0n` to mean "I have nothing to say about this
   * candidate"; the engine keeps these at the tail. Callers that
   * want strictly-positive scores should use this helper rather
   * than filtering manually.
   */
  withMinScore(
    strategyId: string,
    minScore: bigint = 1n,
  ): readonly Recommendation[] {
    return this.recommendations.filter(
      (r) => r.strategyId === strategyId && r.score >= minScore,
    );
  }
}