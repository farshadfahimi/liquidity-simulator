// app/core/domains/recommendation/recommendation_engine.class.ts

import {
  CAPITAL_EFFICIENCY_SCALE,
  SECONDS_PER_YEAR,
  capitalEfficiencyRatio,
  ilAtRangeEdges,
} from '../../math';
import type { Pool } from '../pool';
import { Position } from '../position';
import type { IRecommendationStrategy } from '../strategy';
import { Recommendation } from './recommendation.value-object';
import { RecommendationSet } from './recommendation_set.value-object';
import { ScoringConfig } from './scoring_config.value-object';
import type { IRangeGenerator } from './range_generator.interface';
import type { Price } from '../../shared/value_objects';

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

      for (const strategy of input.strategies) {
        const rawScore = strategy.score(input.pool, position);

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
            expectedApr: this.extractExpectedApr(strategy),
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