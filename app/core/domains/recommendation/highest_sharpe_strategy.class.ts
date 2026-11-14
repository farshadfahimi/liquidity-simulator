// app/core/domains/recommendation/highest_sharpe_strategy.class.ts

import {
  SCORE_SCALE,
  aprFromFees,
  capitalEfficiencyRatio,
  sharpeLikeScore,
} from '../../math';
import type { Pool } from '../pool';
import type { Position } from '../position';
import type { IRecommendationStrategy } from '../strategy';

/**
 * Options for {@link HighestSharpeStrategy}.
 *
 * `expectedApr` is the strategy's prior on the candidate's APR. In
 * practice, callers feed it a *historical-replay* APR for the
 * candidate's range (so the strategy is "Sharpe-with-history") OR a
 * global `targetApr` from the {@link ScoringConfig} (so the strategy
 * is "Sharpe-with-assumption").
 *
 * `annualizedVolatility` is the same — fed from a realized-vol
 * computation OR a `targetVol` knob (Phase 7).
 *
 * `riskFreeApr` is subtracted from `expectedApr` before computing
 * the Sharpe ratio. Default 0.
 */
export interface IHighestSharpeStrategyOptions {
  readonly expectedApr: bigint;

  readonly annualizedVolatility: bigint;

  readonly riskFreeApr?: bigint;
}

/**
 * Sharpe-like recommendation strategy.
 *
 * Strategy: produce a candidate, compute its capital-efficiency
 * ratio (as a "is-this-range-tight-enough" filter), compute the
 * Sharpe-like score `(expectedApr − riskFreeApr) / annualizedVol`,
 * and return that score (rescaled to `[0, 1e18]`).
 *
 * The score is normalized against a *soft* ceiling of `2.0` Sharpe
 * (so a Sharpe of 2.0 maps to `1e18`). Above 2.0 it caps at `1e18`;
 * below 0 (i.e. expected APR < risk-free) the strategy emits
 * `0n` so the engine drops the candidate from the ranking.
 *
 * This is the "I trust my APR estimate and want the best risk-adjusted
 * return" choice.
 */
export class HighestSharpeStrategy implements IRecommendationStrategy {
  readonly id = 'highest-sharpe';

  readonly name = 'Highest Sharpe';

  readonly expectedApr: bigint;

  readonly annualizedVolatility: bigint;

  readonly riskFreeApr: bigint;

  /** Score ceiling: a Sharpe ratio of 2.0 maps to `1e18`. */
  static readonly SOFT_CEILING = 2n * SCORE_SCALE;

  constructor(options: IHighestSharpeStrategyOptions) {
    if (options.expectedApr < 0n) {
      throw new Error(
        `HighestSharpeStrategy expectedApr must be non-negative, got ${options.expectedApr}`,
      );
    }

    if (options.annualizedVolatility <= 0n) {
      throw new Error(
        `HighestSharpeStrategy annualizedVolatility must be positive, got ${options.annualizedVolatility}`,
      );
    }

    this.expectedApr = options.expectedApr;
    this.annualizedVolatility = options.annualizedVolatility;
    this.riskFreeApr = options.riskFreeApr ?? 0n;
  }

  /**
   * Construct directly from a fees/principal/window triple (matches
   * the HistoricalReplaySimulation convention).
   */
  static fromFeesWindow(
    feesRaw: bigint,
    principalRaw: bigint,
    windowSeconds: bigint,
    annualizedVolatility: bigint,
    riskFreeApr: bigint = 0n,
  ): HighestSharpeStrategy {
    const expectedApr = aprFromFees(feesRaw, principalRaw, windowSeconds);
    return new HighestSharpeStrategy({
      expectedApr,
      annualizedVolatility,
      riskFreeApr,
    });
  }

  score(pool: Pool, position: Position): bigint {
    const ce = capitalEfficiencyRatio(
      position.range.tickLower,
      position.range.tickUpper,
      pool.state.tick,
    );

    // Gate: any valid range has CE ≥ 1×. The check below is
    // defensive — it catches the (impossible) case where
    // `capitalEfficiencyRatio` returns ≤ 0 due to a bug.
    if (ce <= 0n) {
      return 0n;
    }

    const excessApr = this.expectedApr - this.riskFreeApr;

    if (excessApr <= 0n) {
      return 0n;
    }

    if (this.annualizedVolatility <= 0n) {
      return 0n;
    }

    const sharpe = sharpeLikeScore(
      this.expectedApr,
      this.annualizedVolatility,
      this.riskFreeApr,
    );

    // Normalize: Sharpe ∈ (-∞, ∞). Cap at SOFT_CEILING; floor at 0.
    if (sharpe <= 0n) {
      return 0n;
    }

    if (sharpe >= HighestSharpeStrategy.SOFT_CEILING) {
      return SCORE_SCALE;
    }

    return (sharpe * SCORE_SCALE) / HighestSharpeStrategy.SOFT_CEILING;
  }
}