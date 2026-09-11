// app/core/application/use_cases/compare_strategies.use_case.ts

import {
  RecommendationEngine,
  ConstantRangeGenerator,
  ScoringConfig,
  BalancedStrategy,
  MaximumFeeStrategy,
  LowestRiskStrategy,
  HighestCapitalEfficiencyStrategy,
  HighestSharpeStrategy,
  type IRangeGenerator,
  type IRecommendationStrategy,
} from '../../domains/recommendation';
import type { Pool } from '../../domains/pool';
import { InvalidUseCaseInputError } from '../errors/invalid_input_error';
import type { IRecommendationDTO } from '../dtos/recommendation.dto';

/**
 * Input for {@link CompareStrategiesUseCase}.
 *
 * `pool` is a live {@link Pool} aggregate (typically the result of
 * `adapter.getPoolState(...)` wrapped through {@link AnalyzePoolUseCase}).
 *
 * `generator` is the {@link IRangeGenerator} the use case should
 * feed into the recommendation engine. When omitted, the use case
 * builds a {@link ConstantRangeGenerator} over `widthsTicks` (default
 * 5 widths spanning tight to very wide).
 *
 * `strategies` is the list of strategies to score with. When omitted,
 * the use case builds the default 5 strategies (Balanced,
 * MaximumFee, LowestRisk, HighestCapitalEfficiency, HighestSharpe)
 * using `expectedApr` (default 30%), `annualizedVolatility`
 * (default 50%), and `entryPrice` (default `pool.currentPrice(18)`).
 *
 * `scoringConfig` lets callers tweak per-strategy weights + global
 * knobs. When omitted, the use case uses {@link defaultScoringConfig}.
 */
export interface ICompareStrategiesInput {
  readonly pool: Pool;

  readonly protocolId?: string;

  readonly generator?: IRangeGenerator;

  readonly strategies?: readonly IRecommendationStrategy[];

  readonly scoringConfig?: ScoringConfig;

  readonly expectedApr?: bigint;

  readonly annualizedVolatility?: bigint;

  readonly riskFreeApr?: bigint;

  readonly widthsTicks?: readonly number[];
}

/**
 * Strategy-comparison use case: the LP recommendation flow described
 * in the README's "Recommendation Flow" section. Bundles a default
 * set of strategies + a default range generator + a default
 * scoring config, then runs the {@link RecommendationEngine} and
 * returns a flattened DTO the UI can render directly.
 *
 * Default strategies:
 *   - Balanced — multiplicative blend of APR × CE × IL.
 *   - MaximumFee — geometric mean of APR × CE.
 *   - LowestRisk — rewards wider (lower-CE) ranges.
 *   - HighestCapitalEfficiency — pure-CE ranker.
 *   - HighestSharpe — risk-adjusted.
 *
 * The defaults are tuned for USDC/WETH-style pools with σ ≈ 50%
 * annualized and a target APR of ~30%. Callers wanting custom
 * strategies pass `strategies` explicitly.
 */
export class CompareStrategiesUseCase {
  readonly id = 'compare-strategies';

  private readonly engine: RecommendationEngine = new RecommendationEngine();

  constructor() {}

  execute(input: ICompareStrategiesInput): IRecommendationDTO {
    if (!input.pool) {
      throw new InvalidUseCaseInputError(this.id, 'pool', 'Pool aggregate is required');
    }

    const entryPrice = input.pool.currentPrice(18);

    const expectedApr = input.expectedApr ?? 3n * 10n ** 17n; // 30%
    const annualizedVolatility = input.annualizedVolatility ?? 5n * 10n ** 17n; // 50%
    const riskFreeApr = input.riskFreeApr ?? 0n;

    const generator = input.generator ?? new ConstantRangeGenerator({
      widthsTicks: input.widthsTicks ?? [100, 500, 2000, 10000, 50000],
    });

    const strategies = input.strategies ?? [
      new BalancedStrategy({
        expectedApr,
        annualizedVolatility,
        riskFreeApr,
        entryPrice,
      }),
      new MaximumFeeStrategy({ expectedApr }),
      new LowestRiskStrategy({ entryPrice }),
      new HighestCapitalEfficiencyStrategy(),
      new HighestSharpeStrategy({
        expectedApr,
        annualizedVolatility,
        riskFreeApr,
      }),
    ];

    const scoringConfig = input.scoringConfig ?? new ScoringConfig({
      riskFreeApr,
      targetApr: expectedApr,
      realizedVolatilityAnnual: annualizedVolatility,
    });

    const set = this.engine.recommend({
      pool: input.pool,
      generator,
      strategies,
      scoringConfig,
    });

    return toRecommendationDTO(set, input.protocolId ?? '');
  }
}

/**
 * Internal: flatten a `RecommendationSet` into a UI-ready DTO.
 * Exported for the composition root's tests / utilities.
 */
export function toRecommendationDTO(
  set: ReturnType<RecommendationEngine['recommend']>,
  protocolId: string,
): IRecommendationDTO {
  return {
    pool: set.context.pool,
    chainId: set.context.chainId,
    protocolId,
    poolDescription: set.context.poolDescription,
    rangeGeneratorId: set.context.rangeGeneratorId,
    strategyIds: set.context.strategyIds,
    nCandidates: set.context.nCandidates,
    nRecommendations: set.context.nRecommendations,
    nSkipped: set.context.nSkipped,
    recommendations: set.recommendations.map((r) => ({
      id: r.id,
      strategyId: r.strategyId,
      strategyName: r.strategyName,
      tickLower: r.range.tickLower,
      tickUpper: r.range.tickUpper,
      score: r.score,
      expectedApr: r.expectedApr,
      feeRatePerSecond: r.feeRatePerSecond,
      ilAtCurrentPrice: r.ilAtCurrentPrice,
      capitalEfficiency: r.capitalEfficiency,
      riskEstimate: r.riskEstimate,
      currentlyInRange: r.currentlyInRange,
      side: r.side,
    })),
  };
}
