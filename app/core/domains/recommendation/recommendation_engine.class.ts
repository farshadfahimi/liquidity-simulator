// app/core/domains/recommendation/recommendation_engine.class.ts

import {
  CAPITAL_EFFICIENCY_SCALE,
  CE_FACTOR_CEILING,
  SCORE_SCALE,
  SECONDS_PER_YEAR,
  capitalEfficiencyFactor,
  capitalEfficiencyRatio,
  ilAtRangeEdges,
  twoSidedCoverage,
} from '../../math';
import type { Pool } from '../pool';
import { Position } from '../position';
import type { IRecommendationStrategy, IStrategyContext } from '../strategy';
import { Recommendation } from './recommendation.value-object';
import { RecommendationSet } from './recommendation_set.value-object';
import { ScoringConfig } from './scoring_config.value-object';
import type { IRangeGenerator } from './range_generator.interface';
import type { Price, TickRange } from '../../shared/value_objects';
import type { TPoolLiquidity } from '../../shared/types';

/**
 * Input for {@link RecommendationEngine.recommend}.
 *
 * `pool` is the live pool the candidates should be generated against.
 *
 * `generator` is the {@link IRangeGenerator} that supplies candidate
 * tick ranges. (See {@link ConstantRangeGenerator} and
 * {@link VolatilityAdjustedRangeGenerator} for the built-ins.)
 *
 * `strategies` is the list of strategies that will score each
 * candidate. The order is preserved in the {@link RecommendationSet}'s
 * `context.strategyIds`, but the final ranking is by score, not by
 * strategy id.
 *
 * `scoringConfig` controls how the per-strategy scores are weighted
 * and what defaults the strategies should consume (e.g. `riskFreeApr`).
 *
 * `principalInNumeraire` and `numeraireToken` are optional; when
 * supplied they let strategies that need APR (Balanced, MaximumFee,
 * HighestSharpe) compute a *feeRatePerSecond* from a caller-supplied
 * target APR (the `targetApr` in `scoringConfig`). When omitted,
 * those strategies fall back to `0n` APR (and therefore score 0,
 * dropping the candidate from the ranking). The principal only
 * affects how APR is converted to feeRatePerSecond; it doesn't
 * affect the score itself.
 *
 * `feeRatePerSecond` (optional) lets the caller skip the APR-to-fee
 * conversion: if you already know the per-second fee rate as a
 * fraction of principal at 1e18, pass it here.
 */
export interface IRecommendInput {
  readonly pool: Pool;

  readonly generator: IRangeGenerator;

  readonly strategies: readonly IRecommendationStrategy[];

  readonly scoringConfig: ScoringConfig;

  readonly principalInNumeraire?: bigint;

  readonly numeraireToken?: 'token0' | 'token1';

  readonly feeRatePerSecond?: bigint;

  /**
   * @deprecated No longer used: the IL term is the stress IL at the
   * range edge, which needs no entry price. Kept so existing callers
   * keep compiling.
   */
  readonly entryPrice?: Price;

  /**
   * Optional liquidity snapshot for the pool (TVL roadmap slice 4).
   *
   * When supplied together with {@link IRecommendInput.poolFeeApr},
   * {@link IRecommendInput.dailySigmaTicks} and
   * {@link IRecommendInput.horizonDays}, the engine computes a
   * *range-specific* expected APR for every candidate and hands it to
   * the strategies through an {@link IStrategyContext}:
   *
   *     expectedApr = poolFeeApr × capitalEfficiency × P(in range)
   *
   * When any of them is missing the engine runs the "prior" path
   * exactly as before — every strategy keeps its own flat APR and the
   * output is unchanged.
   */
  readonly liquidity?: TPoolLiquidity;

  /**
   * Pool-level fee APR implied by the snapshot's 24h turnover, at
   * `APR_SCALE` (1e18 == 100%/yr). `0n` (or omitted) means "no
   * credible APR" and disables the range-specific path.
   */
  readonly poolFeeApr?: bigint;

  /**
   * Per-day price volatility in *tick* units — the σ the candidate
   * ranges were sized from. Needed to recover each candidate's
   * z-score `k = halfWidth / (σ_daily · √horizonDays)`.
   */
  readonly dailySigmaTicks?: number;

  /**
   * Holding horizon in days — the other half of the `k` recovery.
   */
  readonly horizonDays?: number;
}

/**
 * Recommendation engine: orchestrates the candidate → strategy-score
 * → weighted-rank pipeline.
 *
 * Pure: no IO. All inputs are in-memory domain objects; all outputs
 * are value objects. The engine is deterministic given the same
 * inputs.
 *
 * Pipeline:
 *
 *   pool + generator
 *     ↓
 *   candidate TickRanges
 *     ↓
 *   for each candidate: compute CE, IL, side
 *     ↓
 *   for each strategy: compute rawScore
 *     ↓
 *   apply scoringConfig weight
 *     ↓
 *   sort by score desc
 *     ↓
 *   emit RecommendationSet
 *
 * Note on Phase 6 scope: the engine **does not** quote token amounts
 * per candidate. The strategies consume `position: Position` (so the
 * caller passes an *already-quoted* position), but in Phase 6 we
 * fabricate a stub `Position` from the candidate range alone — the
 * `liquidity` / `amount0` / `amount1` are zeroed out. Strategies
 * that need those (Phase 7+ will add them) can be added without
 * changing the engine.
 */
export class RecommendationEngine {
  readonly id = 'recommendation-engine';

  constructor() {}

  /**
   * Run the pipeline. Returns an immutable, ranked
   * {@link RecommendationSet}.
   */
  recommend(input: IRecommendInput): RecommendationSet {
    const candidates = input.generator.generate(input.pool);

    if (candidates.length === 0) {
      // Empty generator → empty set. Don't throw — UI wants to
      // render "no candidates" gracefully.
      return new RecommendationSet(
        {
          pool: input.pool.address,
          chainId: input.pool.chainId,
          strategyIds: input.strategies.map((s) => s.id),
          poolDescription: input.pool.describe(),
          rangeGeneratorId: input.generator.id,
          nCandidates: 0,
          nRecommendations: 0,
          nSkipped: 0,
        },
        [],
      );
    }

    const feeRatePerSecond = input.feeRatePerSecond ?? this.deriveFeeRatePerSecond(input);

    const raw: Recommendation[] = [];

    for (const range of candidates) {
      // Phase 7+ will wire `adapter.quotePosition(...)` here. For
      // Phase 6 we ship a zero-amount Position — strategies only
      // consume `range`, so the stub is sufficient.
      const position = new Position(
        input.pool.address,
        range,
        0n,
        0n,
        0n,
        input.pool.state.token0.address,
        input.pool.state.token1.address,
      );

      // Common metrics computed once per candidate.
      const ce = capitalEfficiencyRatio(range.tickLower, range.tickUpper, input.pool.state.tick);
      const sideInfo = this.sideOf(input.pool.state.tick, position.range);
      // Stress IL at the worse range edge. (The previous "IL at current
      // vs entry price" was 0 for every candidate because entry defaults
      // to the current price, so it carried no information.)
      const ilAtCurrentPrice = ilAtRangeEdges(range.tickLower, range.tickUpper, input.pool.state.tick);

      // Pool-aware context (TVL roadmap slice 4). `undefined` whenever
      // the caller didn't supply a usable liquidity snapshot, in which
      // case the strategies keep their flat APR prior and the output is
      // byte-identical to the pre-slice-4 behaviour.
      const context = this.buildStrategyContext(input, range, ce);

      for (const strategy of input.strategies) {
        const rawScore = strategy.score(input.pool, position, context);

        if (rawScore === 0n) {
          continue;
        }

        const weighted = input.scoringConfig.applyWeight(strategy.id, rawScore);

        if (weighted < input.scoringConfig.minScoreToKeep) {
          continue;
        }

        raw.push(
          new Recommendation({
            id: `${strategy.id}:${range.tickLower}-${range.tickUpper}`,
            strategyId: strategy.id,
            strategyName: strategy.name,
            range,
            score: weighted,
            expectedApr: context?.expectedApr ?? this.extractExpectedApr(strategy),
            feeRatePerSecond,
            ilAtCurrentPrice,
            capitalEfficiency: ce,
            riskEstimate: this.extractRiskEstimate(strategy, input),
            currentlyInRange: sideInfo.inRange,
            side: sideInfo.side,
          }),
        );
      }
    }

    raw.sort((a, b) => {
      if (a.score !== b.score) {
        return a.score > b.score ? -1 : 1;
      }

      // Tie-break: higher CE wins.
      if (a.capitalEfficiency !== b.capitalEfficiency) {
        return a.capitalEfficiency > b.capitalEfficiency ? -1 : 1;
      }

      // Final tie-break: lexicographic on `id` so the ordering is
      // stable across calls.
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const nSkipped = candidates.length * input.strategies.length - raw.length;

    return new RecommendationSet(
      {
        pool: input.pool.address,
        chainId: input.pool.chainId,
        strategyIds: input.strategies.map((s) => s.id),
        poolDescription: input.pool.describe(),
        rangeGeneratorId: input.generator.id,
        nCandidates: candidates.length,
        nRecommendations: raw.length,
        nSkipped,
      },
      raw,
    );
  }

  /**
   * Build the per-candidate {@link IStrategyContext} (TVL roadmap
   * slice 4).
   *
   * The expected APR of a candidate is
   *
   *     expectedApr = poolFeeApr × capitalEfficiency × P(in range)
   *
   * with
   *   - `poolFeeApr` — the pool's own fee APR (from the caller's
   *     liquidity snapshot). `0n` / absent → no context at all.
   *   - `capitalEfficiency` — the *normalised* CE factor
   *     (`ln(CE) / ln(ceiling)`, i.e. the very factor the strategies
   *     rank with) rather than the raw CE ratio: the raw ratio is
   *     unbounded (≈ 40× at ±5%), so multiplying it into an APR would
   *     push the "expected APR" far outside any plausible range and
   *     saturate the strategies' APR factor — which would make the
   *     in-range probability irrelevant again. The normalised factor
   *     lives in `[0, 1]`, so `expectedApr ≤ poolFeeApr`.
   *   - `P(in range)` — `2Φ(k) − 1`, where the z-score `k` is
   *     recovered from the candidate's own half-width:
   *     `k = halfWidth / (σ_daily · √horizonDays)`.
   *
   * Returns `undefined` when the caller didn't supply everything the
   * formula needs — the strategies then use their own APR prior and
   * the output is identical to the pre-slice-4 behaviour.
   */
  private buildStrategyContext(
    input: IRecommendInput,
    range: TickRange,
    ce: bigint,
  ): IStrategyContext | undefined {
    const liquidity = input.liquidity;
    const poolFeeApr = input.poolFeeApr ?? 0n;

    if (!liquidity || poolFeeApr <= 0n) {
      return undefined;
    }

    const sigma = input.dailySigmaTicks ?? 0;
    const horizon = input.horizonDays ?? 0;

    if (!Number.isFinite(sigma) || sigma <= 0) {
      return undefined;
    }

    if (!Number.isFinite(horizon) || horizon <= 0) {
      return undefined;
    }

    // z-score of the candidate: how many σ of the horizon fit into
    // half of the candidate range.
    const halfWidth = (range.tickUpper - range.tickLower) / 2;
    const k = halfWidth / (sigma * Math.sqrt(horizon));

    const inRangeProbability = twoSidedCoverage(k);
    const ceFactor = capitalEfficiencyFactor(ce, CE_FACTOR_CEILING);

    // APR_SCALE × CE_FACTOR_SCALE × NORMAL_CDF_SCALE ÷ SCORE_SCALE²
    // → APR_SCALE. (All three scales are 1e18.)
    const expectedApr = (poolFeeApr * ceFactor * inRangeProbability)
      / (SCORE_SCALE * SCORE_SCALE);

    return {
      expectedApr,
      poolFeeApr,
      tvlUsd: liquidity.tvlUsd,
      inRangeProbability,
    };
  }

  /**
   * Compute the `feeRatePerSecond` we'll stamp onto every
   * recommendation. If the caller supplied one explicitly, use it.
   * Otherwise derive from `scoringConfig.targetApr` over
   * `SECONDS_PER_YEAR`.
   *
   * This is the same convention the Phase 5
   * `HistoricalReplaySimulation` uses:
   *
   *     feeRatePerSecond = apr_fraction_1e18 / SECONDS_PER_YEAR
   */
  private deriveFeeRatePerSecond(input: IRecommendInput): bigint {
    const apr = input.scoringConfig.targetApr;

    if (apr <= 0n) {
      return 0n;
    }

    return apr / SECONDS_PER_YEAR;
  }

  /**
   * Pull `expectedApr` from a strategy. We duck-type: if the
   * strategy exposes a public `expectedApr` field, use it; else
   * emit `0n`.
   *
   * This is a deliberate trade-off: it avoids coupling the engine
   * to the concrete strategy types (Phase 7+ may add strategies
   * that compute APR per-call instead of carrying a fixed value).
   */
  private extractExpectedApr(strategy: IRecommendationStrategy): bigint {
    const candidate = strategy as IRecommendationStrategy & { expectedApr?: bigint };

    return candidate.expectedApr ?? 0n;
  }

  /**
   * Pull `riskEstimate` from a strategy. Same duck-type trick.
   * For Phase 6 strategies, we use `annualizedVolatility` directly
   * when present.
   */
  private extractRiskEstimate(
    strategy: IRecommendationStrategy,
    input: IRecommendInput,
  ): bigint {
    const candidate = strategy as IRecommendationStrategy & {
      annualizedVolatility?: bigint;
    };

    if (candidate.annualizedVolatility !== undefined) {
      return candidate.annualizedVolatility;
    }

    return input.scoringConfig.realizedVolatilityAnnual;
  }

  private sideOf(
    tick: number,
    range: { tickLower: number; tickUpper: number },
  ): { inRange: boolean; side: 'below' | 'inside' | 'above' } {
    if (tick < range.tickLower) {
      return { inRange: false, side: 'below' };
    }

    if (tick > range.tickUpper) {
      return { inRange: false, side: 'above' };
    }

    return { inRange: true, side: 'inside' };
  }
}

/**
 * Re-export the scale constants so callers don't need to import from
 * `@core/math` separately.
 */
export { CAPITAL_EFFICIENCY_SCALE };