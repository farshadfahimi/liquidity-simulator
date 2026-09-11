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
import { sqrtPriceX96ToPrice, sqrtRatioAtTick } from '@core/shared/value_objects';
import { CAPITAL_EFFICIENCY_SCALE, SCORE_SCALE } from '@core/math';

import { PRICE_DECIMALS } from '../test-constants';
import { buildSyntheticHistory } from '../_helpers';

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
    token0: { address: `0x${string}`; symbol: string; decimals: number };
    token1: { address: `0x${string}`; symbol: string; decimals: number };
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
      token0: { address: MAINNET_USDC, symbol: 'USDC', decimals: 6 },
      token1: { address: MAINNET_WETH, symbol: 'WETH', decimals: 18 },
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
});
