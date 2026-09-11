// app/core/domains/recommendation/recommendation.value-object.ts

import { TickRange } from '../../shared/value_objects';
import {
  APR_SCALE,
  CAPITAL_EFFICIENCY_SCALE,
  IL_SCALE,
  SCORE_SCALE,
} from '../../math';

/**
 * One ranked recommendation for a single (pool, candidate range,
 * strategy) triple. Designed to be UI-ready: every meaningful scalar
 * is exposed, and every scalar that has a `*_SCALE` is documented
 * next to its scale.
 *
 * The recommendation is **immutable**. To re-rank (e.g. when the user
 * changes the principal), build a fresh `RecommendationSet` via
 * {@link RecommendationEngine.recommend}.
 *
 * Sign / unit conventions:
 *   - `score` is a unitless value in `[0, 1e18]`; `0n` is reserved
 *     for "this strategy has nothing to say about this candidate"
 *     and the recommendation engine sorts `0n` entries to the
 *     bottom.
 *   - `expectedApr` and `annualizedApr` are at `APR_SCALE` (1e18 ==
 *     100%/year). Negative values are possible if the strategy
 *     models `riskFreeApr` overhead.
 *   - `ilAtCurrentPrice` is at `IL_SCALE` (1e18 == 100%). Negative
 *     means a loss vs HODL.
 *   - `capitalEfficiency` is at `CAPITAL_EFFICIENCY_SCALE` (1e18 ==
 *     1× V2-equivalent).
 *   - `riskEstimate` is at `SCORE_SCALE` (1e18 == 1.0). Higher means
 *     riskier (a derived composite from the strategy).
 */
export interface IRecommendationFields {
  /** Stable id: `"{strategyId}:{rangeDescriptor}"`. */
  readonly id: string;

  /** Strategy id that produced this recommendation. */
  readonly strategyId: string;

  /** Human-friendly strategy name (e.g. "Balanced", "Maximum Fee"). */
  readonly strategyName: string;

  /** Candidate range that was scored. */
  readonly range: TickRange;

  /** Composite score (higher == better). At `SCORE_SCALE`. */
  readonly score: bigint;

  /**
   * Expected APR (annualized) under the strategy's assumptions.
   * At `APR_SCALE`. For strategies that don't compute APR (e.g. pure
   * CE rankers), this is `0n`.
   */
  readonly expectedApr: bigint;

  /**
   * Per-second fee rate as a *fraction* of principal at 1e18
   * precision. `0n` if the strategy doesn't compute fees. Callers
   * running a {@link HistoricalReplaySimulation} consume this.
   */
  readonly feeRatePerSecond: bigint;

  /**
   * IL at the current pool price vs the candidate's entry price.
   * At `IL_SCALE`. Negative == loss vs HODL. `0n` if the strategy
   * doesn't compute IL (rare).
   */
  readonly ilAtCurrentPrice: bigint;

  /** Capital-efficiency ratio for the candidate range. At `CAPITAL_EFFICIENCY_SCALE`. */
  readonly capitalEfficiency: bigint;

  /**
   * Composite risk estimate (higher == riskier). Strategy-defined.
   * At `SCORE_SCALE`. For example, a Sharpe-like strategy uses
   * annualized volatility directly.
   */
  readonly riskEstimate: bigint;

  /** In-range at the current tick? */
  readonly currentlyInRange: boolean;

  /** Side of the current tick relative to the candidate range. */
  readonly side: 'below' | 'inside' | 'above';
}

/**
 * Immutable recommendation value object. Wraps a typed record plus
 * the source {@link TickRange} (kept as a class instance so callers
 * can use the typed helpers like `range.contains(tick)`).
 *
 * The constructor is `public` because callers (e.g. the
 * recommendation engine) build these directly. It is, however,
 * validated: `score` must be `≥ 0n` (a negative score is meaningless
 * for ranking; strategies should clamp before storing).
 */
export class Recommendation {
  readonly id: string;

  readonly strategyId: string;

  readonly strategyName: string;

  readonly range: TickRange;

  readonly score: bigint;

  readonly expectedApr: bigint;

  readonly feeRatePerSecond: bigint;

  readonly ilAtCurrentPrice: bigint;

  readonly capitalEfficiency: bigint;

  readonly riskEstimate: bigint;

  readonly currentlyInRange: boolean;

  readonly side: 'below' | 'inside' | 'above';

  /** Re-exported scales so callers don't need to import from `@core/math`. */
  static readonly APR_SCALE = APR_SCALE;

  static readonly CAPITAL_EFFICIENCY_SCALE = CAPITAL_EFFICIENCY_SCALE;

  static readonly IL_SCALE = IL_SCALE;

  static readonly SCORE_SCALE = SCORE_SCALE;

  constructor(fields: IRecommendationFields) {
    if (fields.score < 0n) {
      throw new Error(
        `Recommendation score must be non-negative, got ${fields.score}`,
      );
    }

    if (fields.capitalEfficiency <= 0n) {
      throw new Error(
        `Recommendation capitalEfficiency must be positive, got ${fields.capitalEfficiency}`,
      );
    }

    if (fields.expectedApr < 0n) {
      throw new Error(
        `Recommendation expectedApr must be non-negative, got ${fields.expectedApr}`,
      );
    }

    if (fields.feeRatePerSecond < 0n) {
      throw new Error(
        `Recommendation feeRatePerSecond must be non-negative, got ${fields.feeRatePerSecond}`,
      );
    }

    if (fields.riskEstimate < 0n) {
      throw new Error(
        `Recommendation riskEstimate must be non-negative, got ${fields.riskEstimate}`,
      );
    }

    this.id = fields.id;
    this.strategyId = fields.strategyId;
    this.strategyName = fields.strategyName;
    this.range = fields.range;
    this.score = fields.score;
    this.expectedApr = fields.expectedApr;
    this.feeRatePerSecond = fields.feeRatePerSecond;
    this.ilAtCurrentPrice = fields.ilAtCurrentPrice;
    this.capitalEfficiency = fields.capitalEfficiency;
    this.riskEstimate = fields.riskEstimate;
    this.currentlyInRange = fields.currentlyInRange;
    this.side = fields.side;
  }

  /** Format the score as a "0..1" decimal string at `SCORE_SCALE` precision. */
  scoreDecimal(): string {
    return formatBigIntAsDecimal(this.score, 18);
  }

  /** Format `expectedApr` as a percentage (e.g. "0.30" == 30%). */
  expectedAprPercent(): string {
    return formatBigIntAsDecimal(this.expectedApr, 18);
  }

  /**
   * Format `ilAtCurrentPrice` as a percentage. Negative IL is shown
   * with a leading `-` (e.g. "-0.0014" == -0.14% IL).
   */
  ilPercent(): string {
    return formatBigIntAsDecimal(this.ilAtCurrentPrice, 18);
  }

  /** Format `capitalEfficiency` as a multiplier (e.g. "2.5" == 2.5× V2). */
  capitalEfficiencyMultiplier(): string {
    return formatBigIntAsDecimal(this.capitalEfficiency, 18);
  }
}

/**
 * Format a scaled bigint as a fixed-precision decimal string with
 * no rounding. Mirrors the helper in `price.value-object.ts` so
 * recommendation formatting works without importing that module.
 */
function formatBigIntAsDecimal(value: bigint, decimals: number): string {
  if (decimals === 0) {
    return value.toString();
  }

  const isNegative = value < 0n;
  const abs = isNegative ? -value : value;
  const padded = abs.toString().padStart(decimals, '0');
  const head = padded.slice(0, padded.length - decimals) || '0';
  const tail = padded.slice(padded.length - decimals);
  const formatted = tail.length > 0 ? `${head}.${tail}` : head;

  return isNegative ? `-${formatted}` : formatted;
}