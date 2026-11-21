// app/core/domains/recommendation/scoring_config.value-object.ts

import {
  APR_SCALE,
  CAPITAL_EFFICIENCY_SCALE,
  SCORE_SCALE,
  VOLATILITY_SCALE,
} from '../../math';

/**
 * Configuration that drives how the {@link RecommendationEngine}
 * combines strategy outputs into a single ranked set.
 *
 * Philosophy: a strategy returns a *raw* per-candidate score
 * (already in `[0, 1e18]` at `SCORE_SCALE`), and the engine
 * multiplies by the strategy's `weight` (also at `SCORE_SCALE`
 * precision, 1e18 == 1.0×). Weights can be > 1 (boosting a strategy)
 * or < 1 (suppressing it). Negative weights are allowed only in the
 * sense of "rank-by-minus" — but the engine itself doesn't
 * interpret sign; strategies do.
 *
 * Other knobs:
 *   - `riskFreeApr` — added to all APR-driven strategies. Useful
 *     when comparing LP vs a risk-free yield like aUSDC.
 *   - `targetApr` — used by some strategies as their "expected APR"
 *     when no historical fee data is available. Strategies that
 *     compute APR from history ignore this.
 *   - `minScoreToKeep` — recommendations scoring below this are
 *     moved to a "skipped" bucket. Default 1n (i.e. only "0n"
 *     entries are skipped).
 */
export interface IScoringConfigFields {
  /**
   * Per-strategy weight multipliers. Strategies not listed default
   * to `SCORE_SCALE` (1.0× — no scaling).
   *
   * Optional: omitting it (or passing an empty map) means "1.0× on
   * every strategy", which is what {@link defaultScoringConfig}
   * does.
   */
  readonly weights?: Readonly<Record<string, bigint>>;

  /**
   * Risk-free APR subtracted from strategy-derived APR before
   * scoring. At `APR_SCALE` (1e18 == 100%). Default `0n`.
   */
  readonly riskFreeApr?: bigint;

  /**
   * Target APR that strategies without their own fee estimate can
   * use as a fallback. At `APR_SCALE` (1e18 == 100%). Default `0n`
   * — strategies that need APR without history should treat this
   * as "unknown" and refuse to score.
   */
  readonly targetApr?: bigint;

  /**
   * Realized volatility (annualized, at `VOLATILITY_SCALE`) used by
   * Sharpe-style strategies. Strategies that don't need vol ignore
   * this.
   */
  readonly realizedVolatilityAnnual?: bigint;

  /**
   * Capital-efficiency floor (at `CAPITAL_EFFICIENCY_SCALE`).
   * Candidates with CE below this are penalized by some strategies
   * (e.g. MaximumFeeStrategy). Default `1e18` (1× V2-equivalent).
   */
  readonly minCapitalEfficiency?: bigint;

  /**
   * Minimum final score a recommendation must reach to be kept in
   * the output set. Default `1n` (i.e. only explicit `0n` from the
   * strategy is dropped).
   */
  readonly minScoreToKeep?: bigint;
}

/**
 * Immutable scoring config. Use {@link defaultScoringConfig} or
 * {@link createScoringConfig} to construct; both helpers apply the
 * documented defaults.
 */
export class ScoringConfig {
  readonly weights: Readonly<Record<string, bigint>>;

  readonly riskFreeApr: bigint;

  readonly targetApr: bigint;

  readonly realizedVolatilityAnnual: bigint;

  readonly minCapitalEfficiency: bigint;

  readonly minScoreToKeep: bigint;

  static readonly APR_SCALE = APR_SCALE;

  static readonly CAPITAL_EFFICIENCY_SCALE = CAPITAL_EFFICIENCY_SCALE;

  static readonly VOLATILITY_SCALE = VOLATILITY_SCALE;

  static readonly SCORE_SCALE = SCORE_SCALE;

  constructor(fields: IScoringConfigFields = {}) {
    for (const [strategyId, weight] of Object.entries(fields.weights ?? {})) {
      if (weight < 0n) {
        throw new Error(
          `ScoringConfig.weights[${strategyId}] must be non-negative, got ${weight}`,
        );
      }
    }

    this.weights = { ...(fields.weights ?? {}) };
    this.riskFreeApr = fields.riskFreeApr ?? 0n;
    this.targetApr = fields.targetApr ?? 0n;
    this.realizedVolatilityAnnual = fields.realizedVolatilityAnnual ?? 0n;
    this.minCapitalEfficiency = fields.minCapitalEfficiency ?? CAPITAL_EFFICIENCY_SCALE;
    this.minScoreToKeep = fields.minScoreToKeep ?? 1n;

    if (this.realizedVolatilityAnnual < 0n) {
      throw new Error(
        `ScoringConfig.realizedVolatilityAnnual must be non-negative, got ${this.realizedVolatilityAnnual}`,
      );
    }

    if (this.minCapitalEfficiency <= 0n) {
      throw new Error(
        `ScoringConfig.minCapitalEfficiency must be positive, got ${this.minCapitalEfficiency}`,
      );
    }

    if (this.minScoreToKeep < 0n) {
      throw new Error(
        `ScoringConfig.minScoreToKeep must be non-negative, got ${this.minScoreToKeep}`,
      );
    }
  }

  /**
   * Look up the weight for `strategyId`. Default `SCORE_SCALE` (1.0×).
   */
  weightFor(strategyId: string): bigint {
    return this.weights[strategyId] ?? ScoringConfig.SCORE_SCALE;
  }

  /**
   * Compose the final score for a single recommendation by
   * multiplying the raw score by the strategy weight (both at
   * `SCORE_SCALE` precision). The result is **clamped** to
   * `[0, SCORE_SCALE]` so weighted scores stay in the documented
   * `[0, 1e18]` invariant of {@link IRecommendationFields.score}.
   *
   * Note that with weight > 1×, a strategy whose raw score was
   * already saturating at SCORE_SCALE will still saturate after
   * weighting — the clamp prevents out-of-range scores but also
   * means a 2× weight on an already-saturated strategy is a no-op
   * (the boost is wasted on the cap). Callers wanting strict
   * weight-induced dominance should lower the strategy's `MAX_*`
   * ceiling to leave headroom.
   */
  applyWeight(
    strategyId: string,
    rawScore: bigint,
  ): bigint {
    if (rawScore < 0n) {
      throw new Error(
        `ScoringConfig.applyWeight requires non-negative rawScore, got ${rawScore}`,
      );
    }

    if (rawScore > ScoringConfig.SCORE_SCALE) {
      throw new Error(
        `ScoringConfig.applyWeight requires rawScore <= SCORE_SCALE, got ${rawScore}`,
      );
    }

    const weight = this.weightFor(strategyId);

    if (weight === ScoringConfig.SCORE_SCALE) {
      return rawScore;
    }

    const product = (rawScore * weight) / ScoringConfig.SCORE_SCALE;

    if (product > ScoringConfig.SCORE_SCALE) {
      return ScoringConfig.SCORE_SCALE;
    }

    return product;
  }
}

/**
 * Default scoring config: 1.0× on every strategy, no risk-free
 * subtraction, no vol override, no min-CE, no score floor beyond
 * `1n` (i.e. only explicit `0n` is dropped).
 */
export function defaultScoringConfig(): ScoringConfig {
  return new ScoringConfig({});
}

/**
 * Construct a scoring config from a partial set of fields. Pass only
 * the fields you want to override; the rest default per
 * {@link ScoringConfig}.
 */
export function createScoringConfig(
  fields: IScoringConfigFields,
): ScoringConfig {
  return new ScoringConfig(fields);
}