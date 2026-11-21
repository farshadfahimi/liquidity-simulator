// app/core/application/use_cases/compare_strategies.use_case.ts

import {
  blendedSigmaTicksPerSecond,
  dailySigmaTicksFromAnnualVol,
  dailySigmaTicksFromSigmaPerSecond,
} from '../../math';
import {
  RecommendationEngine,
  ConstantRangeGenerator,
  VolatilityAdjustedRangeGenerator,
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
import type { IPoolHistoryDTO } from '../dtos/pool_history.dto';
import type { TPoolLiquidity } from '../../shared/types';
import { impliedFeeApr } from './implied_fee_apr.util';

/**
 * Input for {@link CompareStrategiesUseCase}.
 *
 * `pool` is a live {@link Pool} aggregate (typically the result of
 * `adapter.getPoolState(...)` wrapped through {@link AnalyzePoolUseCase}).
 *
 * `generator` is the {@link IRangeGenerator} the use case should
 * feed into the recommendation engine. When omitted the use case
 * picks one, in this order:
 *
 *   1. `widthsTicks` given → {@link ConstantRangeGenerator} over those
 *      widths (explicit opt-in; widths are multiples of the pool's
 *      `tickSpacing`, so they mean different things per fee tier).
 *   2. `history` given with `source === 'on-chain'` and enough samples →
 *      {@link VolatilityAdjustedRangeGenerator} fed by the σ measured
 *      in tick space over the trailing 14 / 30 / 60 days.
 *   3. otherwise → the same generator fed by `annualizedVolatility`
 *      (default 50%) converted to daily ticks.
 *
 * In (2) and (3) the half-widths are `k · σ_daily · √horizonDays`
 * ticks for each `k` in `kValues`, so they are independent of the
 * fee tier / tickSpacing and of token decimals.
 *
 * `history` is the result of `GetPoolHistoryUseCase` (ideally a
 * ≥ 30-day window). Synthetic histories are ignored for σ — their
 * volatility is made up. When `annualizedVolatility` is omitted it
 * is taken from `history.annualizedVolatility` (if on-chain and > 0).
 *
 * `horizonDays` (default 7) is how long the position is expected to
 * be held before rebalancing; `kValues` (default `[1, 1.65, 2, 2.5]`)
 * are the σ-multipliers of the candidate ranges.
 *
 * `strategies` is the list of strategies to score with. When omitted,
 * the use case builds the default 5 strategies (Balanced,
 * MaximumFee, LowestRisk, HighestCapitalEfficiency, HighestSharpe)
 * using `expectedApr` (default 30%), `annualizedVolatility`
 * (default 50%), and `entryPrice` (default `pool.currentPrice(18)`).
 *
 * `scoringConfig` lets callers tweak per-strategy weights + global
 * knobs. When omitted, the use case uses {@link defaultScoringConfig}.
 *
 * `liquidity` is an optional liquidity snapshot (TVL roadmap slice 4).
 * When supplied, the pool's own fee APR is derived from its 24h
 * turnover (`APR = volume/TVL × feeRate × 365`) and used instead of
 * the flat 30% prior. The engine then makes the APR *range-specific*
 * per candidate:
 *
 *     expectedApr = poolFeeApr × capitalEfficiency × P(in range)
 *
 * When `liquidity` is omitted — or the implied APR is not credible
 * (no volume, no TVL, or an outlier > 10,000%/yr) — the use case
 * falls back to the 30% prior and the output is byte-identical to
 * the pre-slice-4 behaviour.
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

  readonly history?: IPoolHistoryDTO;

  readonly horizonDays?: number;

  readonly kValues?: readonly number[];

  /**
   * Optional liquidity snapshot (TVL roadmap slice 4). When
   * supplied, the pool's own fee APR replaces the flat 30% prior and
   * the engine computes a range-specific expected APR per candidate.
   */
  readonly liquidity?: TPoolLiquidity;
}

/** Default σ-multipliers: ≈ 68% / 90% / 95% / 99% end-of-horizon coverage. */
export const DEFAULT_K_VALUES: readonly number[] = [1, 1.65, 2, 2.5];

/** Default holding horizon, in days. */
export const DEFAULT_HORIZON_DAYS = 7;

/** Minimum samples before a history is trusted for σ. */
const MIN_HISTORY_SAMPLES = 10;

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

    // TVL roadmap slice 4 — the pool's own fee APR, implied by the
    // snapshot's 24h turnover:
    //
    //     APR = (volume24hUsd / tvlUsd) × feeRate × 365
    //
    // `impliedFeeApr` returns `0n` when the turnover is unknown or
    // when the implied APR is an outlier (> 10,000%/yr) — in both
    // cases we keep the flat 30% prior.
    const poolFeeApr = input.liquidity
      ? impliedFeeApr(
          input.pool.state.fee,
          input.liquidity.volume24hUsd,
          input.liquidity.tvlUsd,
        )
      : 0n;

    const expectedApr = input.expectedApr ?? (poolFeeApr > 0n ? poolFeeApr : 3n * 10n ** 17n); // 30%
    const riskFreeApr = input.riskFreeApr ?? 0n;
    const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
    const kValues = input.kValues ?? DEFAULT_K_VALUES;

    if (!Number.isFinite(horizonDays) || horizonDays <= 0) {
      throw new InvalidUseCaseInputError(this.id, 'horizonDays', 'must be a positive number');
    }

    if (kValues.length === 0 || kValues.some((k) => !Number.isFinite(k) || k <= 0)) {
      throw new InvalidUseCaseInputError(this.id, 'kValues', 'must be a non-empty list of positive numbers');
    }

    const onChainHistory = input.history
      && input.history.source === 'on-chain'
      && input.history.snapshots.length >= MIN_HISTORY_SAMPLES
      ? input.history
      : null;

    const historyVol = onChainHistory && onChainHistory.annualizedVolatility > 0n
      ? onChainHistory.annualizedVolatility
      : undefined;

    const annualizedVolatility = input.annualizedVolatility
      ?? historyVol
      ?? 5n * 10n ** 17n; // 50% prior

    // The generator's σ (daily, in tick units) is also what the engine
    // needs to recover each candidate's z-score `k`. When the caller
    // brings their own generator we still resolve σ — but guarded, so
    // a malformed volatility can never break a custom generator — and
    // it is only used for the pool-aware context.
    const { generator, dailySigmaTicks } = input.generator
      ? {
          generator: input.generator,
          dailySigmaTicks: this.tryDailySigmaTicks(onChainHistory, annualizedVolatility),
        }
      : this.buildGenerator(input, onChainHistory, annualizedVolatility, horizonDays, kValues);

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
      // TVL roadmap slice 4 — the pool-aware context. Without a
      // liquidity snapshot (or without a credible pool fee APR) the
      // engine keeps the "prior" path and the output is unchanged.
      ...(input.liquidity !== undefined ? { liquidity: input.liquidity } : {}),
      ...(poolFeeApr > 0n ? { poolFeeApr } : {}),
      ...(dailySigmaTicks !== null ? { dailySigmaTicks } : {}),
      horizonDays,
    });

    return toRecommendationDTO(set, input.protocolId ?? '');
  }

  /**
   * Pick the default range generator (see {@link ICompareStrategiesInput}).
   * Half-width for each `k` is `k · σ_daily · √horizonDays` ticks.
   *
   * Also returns the σ it used — the engine needs the very same
   * number to recover each candidate's z-score `k` (slice 4).
   */
  private buildGenerator(
    input: ICompareStrategiesInput,
    history: IPoolHistoryDTO | null,
    annualizedVolatility: bigint,
    horizonDays: number,
    kValues: readonly number[],
  ): { generator: IRangeGenerator; dailySigmaTicks: number | null } {
    if (input.widthsTicks) {
      return {
        generator: new ConstantRangeGenerator({ widthsTicks: input.widthsTicks }),
        // A fixed width list doesn't need σ to size its ranges, but
        // the engine still wants it for the pool-aware context — so
        // resolve it in guarded mode.
        dailySigmaTicks: this.tryDailySigmaTicks(history, annualizedVolatility),
      };
    }

    const dailySigmaTicks = this.computeDailySigmaTicks(history, annualizedVolatility);

    return {
      generator: new VolatilityAdjustedRangeGenerator({
        dailySigmaTicks,
        sigmaMultipliers: kValues.map((k) => k * Math.sqrt(horizonDays)),
      }),
      dailySigmaTicks,
    };
  }

  /**
   * Daily σ in *tick* units — measured from the on-chain history when
   * it is usable, otherwise from the annualized-volatility prior.
   */
  private computeDailySigmaTicks(
    history: IPoolHistoryDTO | null,
    annualizedVolatility: bigint,
  ): number {
    let dailySigmaTicks: number | null = null;

    if (history) {
      try {
        dailySigmaTicks = dailySigmaTicksFromSigmaPerSecond(
          blendedSigmaTicksPerSecond(history.snapshots),
        );
      } catch {
        // Too few distinct timestamps / samples: fall back to the vol prior.
        dailySigmaTicks = null;
      }
    }

    if (dailySigmaTicks === null || !(dailySigmaTicks > 0)) {
      dailySigmaTicks = dailySigmaTicksFromAnnualVol(annualizedVolatility);
    }

    // Flat history / zero vol: keep a strictly positive σ so candidates exist.
    return Math.max(dailySigmaTicks, 1e-6);
  }

  /**
   * Same as {@link CompareStrategiesUseCase.computeDailySigmaTicks},
   * but never throws — used when the caller supplied their own range
   * generator, where a broken volatility must not break the run.
   * `null` means "σ unknown" → the engine keeps the prior path.
   */
  private tryDailySigmaTicks(
    history: IPoolHistoryDTO | null,
    annualizedVolatility: bigint,
  ): number | null {
    try {
      return this.computeDailySigmaTicks(history, annualizedVolatility);
    }
    catch {
      return null;
    }
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
