// app/core/test/recommendation/recommendation.test.ts

/**
 * Phase 6 — Recommendation Engine (was: `scripts/smoke-test-phase6.ts`).
 *
 * Exercises the RecommendationEngine + 5 concrete
 * IRecommendationStrategy implementations against a live (when
 * reachable) + synthetic fallback USDC/WETH 0.05% pool.
 */

import { mainnet } from 'viem/chains';

import { describe, expect, it } from 'vitest';

import { createRpcProvider } from '@core/providers/rpc';
import { createUniswapV3Adapter } from '@core/adapters/uniswap/v3';
import {
  createAnalyticsEngine,
  createBalancedStrategy,
  createConstantRangeGenerator,
  createHighestCapitalEfficiencyStrategy,
  createHighestSharpeStrategy,
  createLowestRiskStrategy,
  createMaximumFeeStrategy,
  createPool,
  createPoolHistory,
  createRecommendationEngine,
  createScoringConfig,
} from '@core/domains';
import { sqrtPriceX96ToPrice } from '@core/shared/value_objects';
import {
  CAPITAL_EFFICIENCY_SCALE,
  CE_FACTOR_CEILING,
  SCORE_SCALE,
  capitalEfficiencyFactor,
  capitalEfficiencyRatio,
  dailySigmaTicksFromAnnualVol,
  sqrtRatioAtTick,
  twoSidedCoverage,
} from '@core/math';
import type { TPoolLiquidity } from '@core/shared/types';
import type { IRecommendationDTO } from '@core/application/dtos';
import { impliedFeeApr } from '@core/application/use_cases';
import { CompareStrategiesUseCase } from '@core/application/use_cases/compare_strategies.use_case';

import { PRICE_DECIMALS } from '../test-constants';
import { buildSyntheticHistory } from '../_helpers';
import { STUB_POOL, buildPoolState } from '../_fixtures/pool_state_fixture';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';
const MAINNET_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const MAINNET_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
const FEE_500 = 500;
const SYNTH_HISTORY_DAYS = 30;
const DAILY_SIGMA_PCT = 3.0;

interface IPoolFixture {
  poolAddress: `0x${string}`;
  state: {
    pool: `0x${string}`;
    token0: { address: `0x${string}`; symbol: string; name: string; decimals: number };
    token1: { address: `0x${string}`; symbol: string; name: string; decimals: number };
    fee: number;
    tickSpacing: number;
    sqrtPriceX96: bigint;
    tick: number;
    liquidity: bigint;
    feeGrowthGlobal0X128: bigint;
    feeGrowthGlobal1X128: bigint;
  };
}

async function loadLivePool(): Promise<IPoolFixture | null> {
  try {
    const rpc = createRpcProvider({ chain: mainnet, rpcUrls: [RPC_URL] });
    const adapter = createUniswapV3Adapter({ rpc });
    const poolAddress = await adapter.resolvePool(MAINNET_USDC, MAINNET_WETH, FEE_500);
    if (!poolAddress) return null;
    const state = await adapter.getPoolState(poolAddress);
    return { poolAddress, state };
  }
  catch {
    return null;
  }
}

function syntheticFixture(): IPoolFixture {
  const poolAddress = '0x000000000000000000000000000000000000dEaD' as const;
  const currentTick = 198_000;
  const sqrtPriceX96 = sqrtRatioAtTick(currentTick);
  return {
    poolAddress,
    state: {
      pool: poolAddress,
      token0: { address: MAINNET_USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
      token1: { address: MAINNET_WETH, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
      fee: FEE_500,
      tickSpacing: 10,
      sqrtPriceX96,
      tick: currentTick,
      liquidity: 5_000_000_000_000_000_000n,
      feeGrowthGlobal0X128: 0n,
      feeGrowthGlobal1X128: 0n,
    },
  };
}

describe('Phase 6 — Recommendation Engine', () => {
  it('produces ≥1 recommendation, monotonic by score, all 5 strategy ids present', async () => {
    const fixture = (await loadLivePool()) ?? syntheticFixture();
    const pool = createPool({ state: fixture.state, chainId: mainnet.id });
    const currentPrice18 = sqrtPriceX96ToPrice(
      fixture.state.sqrtPriceX96,
      fixture.state.token0.decimals,
      fixture.state.token1.decimals,
      PRICE_DECIMALS,
    );

    const history = createPoolHistory({
      pool: fixture.poolAddress,
      chainId: mainnet.id,
      snapshots: buildSyntheticHistory(
        fixture.poolAddress,
        mainnet.id,
        fixture.state.tick,
        fixture.state.liquidity,
        fixture.state.sqrtPriceX96,
        SYNTH_HISTORY_DAYS,
        DAILY_SIGMA_PCT,
        54_321n,
        currentPrice18.value,
      ),
    });
    const analytics = createAnalyticsEngine();
    const vol = analytics.volatilityFromHistory(history);
    const sigmaAnnual = vol?.volAnnual ?? 5n * 10n ** 17n;

    const expectedApr = 3n * 10n ** 17n;
    const strategies = [
      createBalancedStrategy({ expectedApr, annualizedVolatility: sigmaAnnual, riskFreeApr: 0n, entryPrice: currentPrice18 }),
      createMaximumFeeStrategy({ expectedApr }),
      createLowestRiskStrategy({ entryPrice: currentPrice18 }),
      createHighestCapitalEfficiencyStrategy(),
      createHighestSharpeStrategy({ expectedApr, annualizedVolatility: sigmaAnnual, riskFreeApr: 0n }),
    ];

    const constantGen = createConstantRangeGenerator({ widthsTicks: [100, 500, 2000, 10000, 50000] });
    const candidates = constantGen.generate(pool);
    expect(candidates.length).toBe(5);

    const scoringConfig = createScoringConfig({
      riskFreeApr: 0n,
      targetApr: expectedApr,
      realizedVolatilityAnnual: sigmaAnnual,
      minCapitalEfficiency: CAPITAL_EFFICIENCY_SCALE,
      minScoreToKeep: 1n,
    });

    const engine = createRecommendationEngine();
    const set = engine.recommend({ pool, generator: constantGen, strategies, scoringConfig });

    expect(set.recommendations.length).toBeGreaterThan(0);

    // Monotonic by score.
    for (let i = 1; i < set.recommendations.length; i++) {
      const prev = set.recommendations[i - 1]!.score;
      const curr = set.recommendations[i]!.score;
      expect(curr).toBeLessThanOrEqual(prev);
    }

    // All five strategy IDs are represented.
    const seen = new Set(set.recommendations.map((r) => r.strategyId));
    for (const id of ['balanced', 'maximum-fee', 'lowest-risk', 'highest-capital-efficiency', 'highest-sharpe']) {
      expect(seen.has(id)).toBe(true);
    }

    // Highest-sharpe scored every candidate.
    const sharpe = set.byStrategy('highest-sharpe');
    expect(sharpe.length).toBe(set.context.nCandidates);

    // Every CE > 0 and at least one expectedApr > 0.
    expect(set.recommendations.every((r) => r.capitalEfficiency > 0n)).toBe(true);
    expect(set.recommendations.some((r) => r.expectedApr > 0n)).toBe(true);
  });

  it('0.5× weight on lowest-risk halves the top score (rounding tolerated)', async () => {
    const fixture = (await loadLivePool()) ?? syntheticFixture();
    const pool = createPool({ state: fixture.state, chainId: mainnet.id });
    const currentPrice18 = sqrtPriceX96ToPrice(
      fixture.state.sqrtPriceX96,
      fixture.state.token0.decimals,
      fixture.state.token1.decimals,
      PRICE_DECIMALS,
    );

    const history = createPoolHistory({
      pool: fixture.poolAddress,
      chainId: mainnet.id,
      snapshots: buildSyntheticHistory(
        fixture.poolAddress,
        mainnet.id,
        fixture.state.tick,
        fixture.state.liquidity,
        fixture.state.sqrtPriceX96,
        SYNTH_HISTORY_DAYS,
        DAILY_SIGMA_PCT,
        54_321n,
        currentPrice18.value,
      ),
    });
    const analytics = createAnalyticsEngine();
    const vol = analytics.volatilityFromHistory(history);
    const sigmaAnnual = vol?.volAnnual ?? 5n * 10n ** 17n;
    const expectedApr = 3n * 10n ** 17n;

    const strategies = [
      createBalancedStrategy({ expectedApr, annualizedVolatility: sigmaAnnual, riskFreeApr: 0n, entryPrice: currentPrice18 }),
      createMaximumFeeStrategy({ expectedApr }),
      createLowestRiskStrategy({ entryPrice: currentPrice18 }),
      createHighestCapitalEfficiencyStrategy(),
      createHighestSharpeStrategy({ expectedApr, annualizedVolatility: sigmaAnnual, riskFreeApr: 0n }),
    ];
    const constantGen = createConstantRangeGenerator({ widthsTicks: [100, 500, 2000, 10000, 50000] });

    const baseConfig = createScoringConfig({
      riskFreeApr: 0n,
      targetApr: expectedApr,
      realizedVolatilityAnnual: sigmaAnnual,
    });
    const weightedConfig = createScoringConfig({
      riskFreeApr: 0n,
      targetApr: expectedApr,
      realizedVolatilityAnnual: sigmaAnnual,
      weights: { 'lowest-risk': SCORE_SCALE / 2n },
    });

    const engine = createRecommendationEngine();
    const set = engine.recommend({ pool, generator: constantGen, strategies, scoringConfig: baseConfig });
    const weightedSet = engine.recommend({ pool, generator: constantGen, strategies, scoringConfig: weightedConfig });

    const topLowest = set.topForStrategy('lowest-risk');
    const topLowestWeighted = weightedSet.topForStrategy('lowest-risk');
    expect(topLowest).not.toBeNull();
    expect(topLowestWeighted).not.toBeNull();
    if (!topLowest || !topLowestWeighted) return;

    const expectedHalved = (topLowest.score * (SCORE_SCALE / 2n)) / SCORE_SCALE;
    expect(topLowestWeighted.score).toBe(expectedHalved);
  });

  it('lowest-risk prefers wider ranges than maximum-fee (CE ordering)', async () => {
    const fixture = (await loadLivePool()) ?? syntheticFixture();
    const pool = createPool({ state: fixture.state, chainId: mainnet.id });
    const currentPrice18 = sqrtPriceX96ToPrice(
      fixture.state.sqrtPriceX96,
      fixture.state.token0.decimals,
      fixture.state.token1.decimals,
      PRICE_DECIMALS,
    );

    const history = createPoolHistory({
      pool: fixture.poolAddress,
      chainId: mainnet.id,
      snapshots: buildSyntheticHistory(
        fixture.poolAddress,
        mainnet.id,
        fixture.state.tick,
        fixture.state.liquidity,
        fixture.state.sqrtPriceX96,
        SYNTH_HISTORY_DAYS,
        DAILY_SIGMA_PCT,
        54_321n,
        currentPrice18.value,
      ),
    });
    const analytics = createAnalyticsEngine();
    const vol = analytics.volatilityFromHistory(history);
    const sigmaAnnual = vol?.volAnnual ?? 5n * 10n ** 17n;
    const expectedApr = 3n * 10n ** 17n;

    const strategies = [
      createBalancedStrategy({ expectedApr, annualizedVolatility: sigmaAnnual, riskFreeApr: 0n, entryPrice: currentPrice18 }),
      createMaximumFeeStrategy({ expectedApr }),
      createLowestRiskStrategy({ entryPrice: currentPrice18 }),
      createHighestCapitalEfficiencyStrategy(),
      createHighestSharpeStrategy({ expectedApr, annualizedVolatility: sigmaAnnual, riskFreeApr: 0n }),
    ];
    const constantGen = createConstantRangeGenerator({ widthsTicks: [100, 500, 2000, 10000, 50000] });
    const scoringConfig = createScoringConfig({
      riskFreeApr: 0n,
      targetApr: expectedApr,
      realizedVolatilityAnnual: sigmaAnnual,
    });
    const engine = createRecommendationEngine();
    const set = engine.recommend({ pool, generator: constantGen, strategies, scoringConfig });

    const topLowest = set.topForStrategy('lowest-risk');
    const topMax = set.topForStrategy('maximum-fee');
    expect(topLowest).not.toBeNull();
    expect(topMax).not.toBeNull();
    if (!topLowest || !topMax) return;
    expect(topLowest.capitalEfficiency).toBeLessThanOrEqual(topMax.capitalEfficiency);
  });

  it('engine is deterministic across re-runs with identical inputs', async () => {
    const fixture = (await loadLivePool()) ?? syntheticFixture();
    const pool = createPool({ state: fixture.state, chainId: mainnet.id });
    const currentPrice18 = sqrtPriceX96ToPrice(
      fixture.state.sqrtPriceX96,
      fixture.state.token0.decimals,
      fixture.state.token1.decimals,
      PRICE_DECIMALS,
    );
    const history = createPoolHistory({
      pool: fixture.poolAddress,
      chainId: mainnet.id,
      snapshots: buildSyntheticHistory(
        fixture.poolAddress,
        mainnet.id,
        fixture.state.tick,
        fixture.state.liquidity,
        fixture.state.sqrtPriceX96,
        SYNTH_HISTORY_DAYS,
        DAILY_SIGMA_PCT,
        54_321n,
        currentPrice18.value,
      ),
    });
    const analytics = createAnalyticsEngine();
    const vol = analytics.volatilityFromHistory(history);
    const sigmaAnnual = vol?.volAnnual ?? 5n * 10n ** 17n;
    const expectedApr = 3n * 10n ** 17n;
    const strategies = [
      createBalancedStrategy({ expectedApr, annualizedVolatility: sigmaAnnual, riskFreeApr: 0n, entryPrice: currentPrice18 }),
      createMaximumFeeStrategy({ expectedApr }),
      createLowestRiskStrategy({ entryPrice: currentPrice18 }),
      createHighestCapitalEfficiencyStrategy(),
      createHighestSharpeStrategy({ expectedApr, annualizedVolatility: sigmaAnnual, riskFreeApr: 0n }),
    ];
    const constantGen = createConstantRangeGenerator({ widthsTicks: [100, 500, 2000, 10000, 50000] });
    const scoringConfig = createScoringConfig({
      riskFreeApr: 0n,
      targetApr: expectedApr,
      realizedVolatilityAnnual: sigmaAnnual,
    });
    const engine = createRecommendationEngine();

    const ids1 = engine.recommend({ pool, generator: constantGen, strategies, scoringConfig })
      .recommendations.map((r) => r.id);
    const ids2 = engine.recommend({ pool, generator: constantGen, strategies, scoringConfig })
      .recommendations.map((r) => r.id);
    expect(ids1).toEqual(ids2);
  });

  it('highest-capital-efficiency picks the TIGHTEST range and ranks the widest span last', async () => {
    // The strategy is documented as "I want the tightest range, period".
    // With the real CE (≈ 1× for a full range, growing as the range
    // narrows) the score must fall monotonically with width, and a
    // ~full-range span must score ≈ 0 (it can never win).
    const fixture = (await loadLivePool()) ?? syntheticFixture();
    const pool = createPool({ state: fixture.state, chainId: mainnet.id });
    const constantGen = createConstantRangeGenerator({
      widthsTicks: [100, 500, 2000, 10000, 50000],
    });
    const candidates = constantGen.generate(pool);
    expect(candidates.length).toBeGreaterThan(1);

    // Sanity: the widest candidate is ≥ 1M ticks wide (a near-V2 span).
    const widestWidth = Math.max(
      ...candidates.map((c) => c.tickUpper - c.tickLower),
    );
    expect(widestWidth).toBeGreaterThanOrEqual(1_000_000);

    const strategy = createHighestCapitalEfficiencyStrategy();
    const scoringConfig = createScoringConfig({
      riskFreeApr: 0n,
      targetApr: 3n * 10n ** 17n,
      realizedVolatilityAnnual: 5n * 10n ** 17n,
    });
    const engine = createRecommendationEngine();
    const set = engine.recommend({
      pool,
      generator: constantGen,
      strategies: [strategy],
      scoringConfig,
    });

    const hce = set.byStrategy('highest-capital-efficiency');
    expect(hce.length).toBeGreaterThan(0);

    // Top pick must be the tightest (smallest width) range.
    const top = hce[0]!;
    const topWidth = top.range.tickUpper - top.range.tickLower;
    const minWidth = Math.min(...candidates.map((c) => c.tickUpper - c.tickLower));
    expect(topWidth).toBe(minWidth);
    expect(topWidth).toBeLessThan(20_000);

    // Scores strictly decrease as the range widens.
    const widths = hce.map((r) => r.range.tickUpper - r.range.tickLower);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
      expect(hce[i]!.score).toBeLessThan(hce[i - 1]!.score);
    }

    // The near-full-range span (if kept at all) scores ≈ 0 (< 0.0001%).
    const widest = hce.find((r) => r.range.tickUpper - r.range.tickLower === widestWidth);
    if (widest) {
      expect(widest.score).toBeLessThan(SCORE_SCALE / 1_000_000n);
    }
  });
});

// ---------------------------------------------------------------------------
// TVL roadmap slice 4 — pool-aware recommendations
//
// The pool-aware path replaces the flat 30% APR prior with a
// *range-specific* expected APR:
//
//     expectedApr = poolFeeApr × capitalEfficiencyFactor × P(in range)
//
// where `poolFeeApr` is implied by the pool's 24h turnover
// (`APR = volume/TVL × feeRate × 365`) and `P(in range) = 2Φ(k) − 1`
// with `k = halfWidth / (σ_daily · √horizonDays)`.
//
// Every test below is fully offline: a synthetic USDC/WETH 0.05% pool,
// a synthetic liquidity snapshot and no network access.
// ---------------------------------------------------------------------------

const SLICE4_TICK = 198_000;
const SLICE4_HORIZON_DAYS = 7;
const SLICE4_VOL = 288_500_000_000_000_000n; // 28.85% annualized
const SLICE4_WIDTHS = [10, 100, 500, 2000, 10000] as const;
const SLICE4_TVL_USD = 1_000_000_000_000n; // $1,000,000
const SLICE4_LOW_VOLUME_USD = 274_000_000_000n; // $274,000 → ≈ 5.0%/yr
const SLICE4_HIGH_VOLUME_USD = 2_740_000_000_000n; // $2,740,000 → ≈ 50.0%/yr
const SLICE4_OUTLIER_VOLUME_USD = 10_000_000_000_000_000n; // $10bn → > 10,000%/yr
const SLICE4_PRIOR_APR = 300_000_000_000_000_000n; // the flat 30% prior
const SLICE4_BASELINE_WIDTHS = [100, 500, 2000, 10000, 50000] as const;

/**
 * The exact no-liquidity output captured *before* slice 4 landed.
 * It pins the "no liquidity ⇒ byte-identical output" contract.
 */
const SLICE4_BASELINE: ReadonlyArray<{
  readonly id: string;
  readonly score: string;
  readonly expectedApr: string;
  readonly ce: string;
  readonly il: string;
}> = [
  { id: 'highest-capital-efficiency:197000-199000', score: '655927549121420405', expectedApr: '0', ce: '20505166268106646077', il: '-1248574510551491' },
  { id: 'lowest-risk:193000-203000', score: '651906218647698131', expectedApr: '0', ce: '4521010622504178481', il: '-30453402882693371' },
  { id: 'lowest-risk:178000-218000', score: '583525794791062975', expectedApr: '0', ce: '1582022739970516543', il: '-351921050134174676' },
  { id: 'lowest-risk:197000-199000', score: '343642850786629620', expectedApr: '0', ce: '20505166268106646077', il: '-1248574510551491' },
  { id: 'highest-capital-efficiency:193000-203000', score: '327617444498314091', expectedApr: '0', ce: '4521010622504178481', il: '-30453402882693371' },
  { id: 'maximum-fee:197000-199000', score: '313670419976466797', expectedApr: '300000000000000000', ce: '20505166268106646077', il: '-1248574510551491' },
  { id: 'highest-sharpe:197000-199000', score: '300000000000000000', expectedApr: '300000000000000000', ce: '20505166268106646077', il: '-1248574510551491' },
  { id: 'highest-sharpe:193000-203000', score: '300000000000000000', expectedApr: '300000000000000000', ce: '4521010622504178481', il: '-30453402882693371' },
  { id: 'highest-sharpe:178000-218000', score: '300000000000000000', expectedApr: '300000000000000000', ce: '1582022739970516543', il: '-351921050134174676' },
  { id: 'highest-sharpe:98000-298000', score: '300000000000000000', expectedApr: '300000000000000000', ce: '1006785362427017516', il: '-986521349067637051' },
  { id: 'highest-sharpe:-302000-698000', score: '300000000000000000', expectedApr: '300000000000000000', ce: '1000000000013905313', il: '-1000000000000000000' },
  { id: 'maximum-fee:193000-203000', score: '221681340384677198', expectedApr: '300000000000000000', ce: '4521010622504178481', il: '-30453402882693371' },
  { id: 'balanced:197000-199000', score: '196532572410845666', expectedApr: '300000000000000000', ce: '20505166268106646077', il: '-1248574510551491' },
  { id: 'maximum-fee:178000-218000', score: '122233545360223664', expectedApr: '300000000000000000', ce: '1582022739970516543', il: '-351921050134174676' },
  { id: 'highest-capital-efficiency:178000-218000', score: '99606930742199042', expectedApr: '0', ce: '1582022739970516543', il: '-351921050134174676' },
  { id: 'balanced:193000-203000', score: '95292113540882549', expectedApr: '300000000000000000', ce: '4521010622504178481', il: '-30453402882693371' },
  { id: 'balanced:178000-218000', score: '19365946522428704', expectedApr: '300000000000000000', ce: '1582022739970516543', il: '-351921050134174676' },
  { id: 'maximum-fee:98000-298000', score: '14841386507383016', expectedApr: '300000000000000000', ce: '1006785362427017516', il: '-986521349067637051' },
  { id: 'lowest-risk:98000-298000', score: '13458858274483530', expectedApr: '0', ce: '1006785362427017516', il: '-986521349067637051' },
  { id: 'highest-capital-efficiency:98000-298000', score: '1468445023076871', expectedApr: '0', ce: '1006785362427017516', il: '-986521349067637051' },
  { id: 'balanced:98000-298000', score: '5937797363825', expectedApr: '300000000000000000', ce: '1006785362427017516', il: '-986521349067637051' },
  { id: 'maximum-fee:-302000-698000', score: '672996693899', expectedApr: '300000000000000000', ce: '1000000000013905313', il: '-1000000000000000000' },
  { id: 'highest-capital-efficiency:-302000-698000', score: '3019497', expectedApr: '0', ce: '1000000000013905313', il: '-1000000000000000000' },
];

describe('TVL roadmap slice 4 — pool-aware recommendations', () => {
  function slice4Pool() {
    return createPool({
      chainId: mainnet.id,
      state: buildPoolState({
        tick: SLICE4_TICK,
        liquidity: 5_000_000_000_000_000_000n,
      }),
    });
  }

  function slice4Liquidity(volume24hUsd: bigint): TPoolLiquidity {
    return {
      pool: STUB_POOL,
      chainId: mainnet.id,
      protocolId: 'uniswap-v3',
      tvlUsd: SLICE4_TVL_USD,
      volume24hUsd,
      source: 'defi-llama',
      timestamp: 1_700_000_000n,
    };
  }

  /** Run the slice-4 path (with or without a liquidity snapshot). */
  function runSlice4(volume24hUsd?: bigint) {
    return new CompareStrategiesUseCase().execute({
      pool: slice4Pool(),
      protocolId: 'uniswap-v3',
      widthsTicks: [...SLICE4_WIDTHS],
      horizonDays: SLICE4_HORIZON_DAYS,
      annualizedVolatility: SLICE4_VOL,
      ...(volume24hUsd !== undefined
        ? { liquidity: slice4Liquidity(volume24hUsd) }
        : {}),
    });
  }

  /** Run the pre-slice-4 path (fixed widths, flat 30% prior). */
  function runSlice4Baseline() {
    return new CompareStrategiesUseCase().execute({
      pool: slice4Pool(),
      protocolId: 'uniswap-v3',
      widthsTicks: [...SLICE4_BASELINE_WIDTHS],
      horizonDays: SLICE4_HORIZON_DAYS,
    });
  }

  function topFor(dto: IRecommendationDTO, strategyId: string) {
    const rec = dto.recommendations.find((r) => r.strategyId === strategyId);
    expect(rec, `no recommendation for strategy "${strategyId}"`).toBeDefined();
    return rec!;
  }

  function widthOf(rec: { tickLower: number; tickUpper: number }): number {
    return rec.tickUpper - rec.tickLower;
  }

  it('without a liquidity snapshot the output is byte-identical to the pre-slice-4 baseline', () => {
    const dto = runSlice4Baseline();

    expect(dto.rangeGeneratorId).toBe('constant-range');
    expect(dto.nCandidates).toBe(5);
    expect(dto.nRecommendations).toBe(23);

    const actual = dto.recommendations.map((r) => ({
      id: r.id,
      score: r.score.toString(),
      expectedApr: r.expectedApr.toString(),
      ce: r.capitalEfficiency.toString(),
      il: r.ilAtCurrentPrice.toString(),
    }));

    expect(actual).toEqual(SLICE4_BASELINE);
  });

  it('without a liquidity snapshot the APR-driven strategies keep the flat 30% prior', () => {
    const dto = runSlice4Baseline();

    for (const rec of dto.recommendations) {
      if (rec.strategyId === 'maximum-fee' || rec.strategyId === 'balanced' || rec.strategyId === 'highest-sharpe') {
        expect(rec.expectedApr).toBe(SLICE4_PRIOR_APR);
      }
    }
  });

  it('with a liquidity snapshot the razor-thin range loses to a wider, covered range', () => {
    const prior = runSlice4();
    const withLiquidity = runSlice4(SLICE4_LOW_VOLUME_USD);

    // Prior path: the razor-thin (±100 ticks) range wins on capital
    // efficiency alone.
    const priorTop = topFor(prior, 'maximum-fee');
    expect(widthOf(priorTop)).toBe(200);
    expect(priorTop.expectedApr).toBe(SLICE4_PRIOR_APR);

    // Pool-aware path: the razor-thin range leaves the range almost
    // immediately (P(in range) ≈ 0), so a wider, still-covered range
    // wins even though its capital efficiency is lower.
    const liquidityTop = topFor(withLiquidity, 'maximum-fee');
    expect(widthOf(liquidityTop)).toBe(2000);
    expect(liquidityTop.expectedApr).not.toBe(SLICE4_PRIOR_APR);
    expect(liquidityTop.expectedApr).toBeLessThan(priorTop.expectedApr);

    // The razor-thin candidate is still ranked, but below the wider one.
    const razor = withLiquidity.recommendations.find(
      (r) => r.strategyId === 'maximum-fee' && widthOf(r) === 200,
    );
    expect(razor).toBeDefined();
    expect(razor!.score).toBeLessThan(liquidityTop.score);
  });

  it('the expected APR is poolFeeApr × capital-efficiency factor × P(in range)', () => {
    const dto = runSlice4(SLICE4_LOW_VOLUME_USD);

    const poolFeeApr = impliedFeeApr(
      FEE_500,
      SLICE4_LOW_VOLUME_USD,
      SLICE4_TVL_USD,
    );
    expect(poolFeeApr).toBeGreaterThan(0n);

    const sigma = dailySigmaTicksFromAnnualVol(SLICE4_VOL);
    expect(sigma).toBeGreaterThan(0);

    for (const rec of dto.recommendations) {
      if (rec.expectedApr === 0n) {
        // Pure-CE strategies carry no APR of their own.
        continue;
      }

      const ce = capitalEfficiencyRatio(
        rec.tickLower,
        rec.tickUpper,
        SLICE4_TICK,
      );
      const ceFactor = capitalEfficiencyFactor(ce, CE_FACTOR_CEILING);

      const halfWidth = widthOf(rec) / 2;
      const k = halfWidth / (sigma * Math.sqrt(SLICE4_HORIZON_DAYS));
      const inRangeProbability = twoSidedCoverage(k);

      const expected = (poolFeeApr * ceFactor * inRangeProbability)
        / (SCORE_SCALE * SCORE_SCALE);

      expect(rec.expectedApr).toBe(expected);
      // The normalized CE factor and P(in range) are both ≤ 1, so the
      // range-specific APR can never exceed the pool's own fee APR.
      expect(rec.expectedApr).toBeLessThanOrEqual(poolFeeApr);
    }
  });

  it('two identical pools with different turnover produce different APRs and rankings', () => {
    const low = runSlice4(SLICE4_LOW_VOLUME_USD);
    const high = runSlice4(SLICE4_HIGH_VOLUME_USD);

    const lowTop = topFor(low, 'maximum-fee');
    const highTop = topFor(high, 'maximum-fee');

    // 10× the volume → ≈10× the implied pool fee APR. The relation is
    // approximate because the fixed-point divisions truncate.
    expect(highTop.expectedApr).toBeGreaterThan(lowTop.expectedApr);

    const aprRatio = (highTop.expectedApr * 1000n) / lowTop.expectedApr;
    expect(aprRatio).toBeGreaterThan(9_990n);
    expect(aprRatio).toBeLessThan(10_010n);

    // …and the ranking itself changes: the first four rows are the
    // same (they are APR-independent strategies), but the fifth row
    // swaps from the low-volume winner to the high-volume winner.
    const lowIds = low.recommendations.map((r) => r.id);
    const highIds = high.recommendations.map((r) => r.id);
    expect(highIds).not.toEqual(lowIds);
    expect(highIds.slice(0, 5)).not.toEqual(lowIds.slice(0, 5));

    // The pool's own fee APR is what drives it.
    const lowPoolApr = impliedFeeApr(
      FEE_500,
      SLICE4_LOW_VOLUME_USD,
      SLICE4_TVL_USD,
    );
    const highPoolApr = impliedFeeApr(
      FEE_500,
      SLICE4_HIGH_VOLUME_USD,
      SLICE4_TVL_USD,
    );
    const poolRatio = (highPoolApr * 1000n) / lowPoolApr;
    expect(poolRatio).toBeGreaterThan(9_990n);
    expect(poolRatio).toBeLessThan(10_010n);
  });

  it('an implausible turnover keeps the flat 30% prior and the pre-slice-4 output', () => {
    // $10bn of daily volume on $1M of TVL implies ≫ 10,000%/yr — the
    // clamp zeroes the implied APR and the prior path is restored.
    expect(
      impliedFeeApr(FEE_500, SLICE4_OUTLIER_VOLUME_USD, SLICE4_TVL_USD),
    ).toBe(0n);

    const prior = runSlice4();
    const outlier = runSlice4(SLICE4_OUTLIER_VOLUME_USD);

    expect(outlier.recommendations).toEqual(prior.recommendations);
  });
});
