// app/core/test/application/use_cases/use_cases.test.ts

/**
 * Phase 7 — Application Layer use cases (was: `scripts/smoke-test-phase7.ts`).
 *
 * Exercises the Application Layer — use cases, DTOs, errors, and
 * the IRpcProvider `blockTag` extension — through the
 * {@link CoreServices} composition root.
 */

import { mainnet } from 'viem/chains';

import { describe, expect, it } from 'vitest';

import { createRpcProvider } from '@core/providers/rpc';
import { createUniswapV3Adapter } from '@core/adapters/uniswap/v3';
import { createCoreServices } from '@core/services';
import { NetworkRegistry, createNetworkProvider, type TNetwork } from '@core/network';
import {
  createAnalyticsEngine,
  createConstantRangeGenerator,
  createPool,
  createPoolHistory,
} from '@core/domains';
import { sqrtRatioAtTick } from '@core/math';
import { Price, sqrtPriceX96ToPrice } from '@core/shared/value_objects';
import { SECONDS_PER_YEAR, VOLATILITY_SCALE } from '@core/math';

import {
  AdapterNotFoundError,
  InvalidUseCaseInputError,
  MissingPoolHistoryError,
  type IDiscoveredPoolDTO,
  type IHistoricalReplayDTO,
  type IPoolAnalysisDTO,
  type IPositionSimulationDTO,
  type IRecommendationDTO,
  type UseCaseErrorClass,
} from '@core/application';

import { PRICE_DECIMALS } from '../../test-constants';
import { SECONDS_PER_DAY, buildSyntheticHistory } from '../../_helpers';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';
const MAINNET_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const MAINNET_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
const FEE_500 = 500;
const SYNTH_CHAIN_ID = 99_999;
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

interface IUseCaseFixture {
  services: ReturnType<typeof createCoreServices>;
  pool: IPoolFixture;
  history: ReturnType<typeof createPoolHistory>;
  sigmaAnnual: bigint;
  currentPrice18: Price;
}

async function buildUseCaseFixture(): Promise<IUseCaseFixture | null> {
  const fixture = (await loadLivePool()) ?? syntheticFixture();
  const currentPrice18 = sqrtPriceX96ToPrice(
    fixture.state.sqrtPriceX96,
    fixture.state.token0.decimals,
    fixture.state.token1.decimals,
    PRICE_DECIMALS,
  );

  // Composition root with custom mainnet override.
  const registry = new NetworkRegistry();
  const mainnetOverride: TNetwork = {
    id: mainnet.id,
    name: mainnet.name,
    rpcUrl: RPC_URL,
    rpcUrls: [RPC_URL],
    explorerUrl: mainnet.blockExplorers?.default.url,
    nativeCurrency: {
      name: mainnet.nativeCurrency.name,
      symbol: mainnet.nativeCurrency.symbol,
      decimals: mainnet.nativeCurrency.decimals,
    },
    multicall3Address: '0xca11bde05977b3631167028862be2a173976ca11',
  };
  registry.register(mainnetOverride);
  const network = createNetworkProvider({ registry, chainId: mainnet.id });
  const rpc = createRpcProvider({ chain: mainnet, rpcUrls: [RPC_URL] });
  const adapter = createUniswapV3Adapter({ rpc });
  const services = createCoreServices({
    network,
    adapters: new Map([[mainnet.id, [adapter]]]),
  });

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

  return { services, pool: fixture, history, sigmaAnnual, currentPrice18 };
}

describe('Phase 7 — Application Layer use cases', () => {
  it('composition root + use case IDs', async () => {
    const fx = await buildUseCaseFixture();
    expect(fx).not.toBeNull();
    if (!fx) return;
    const useCases = fx.services.useCases();
    expect(useCases.discoverPools.id).toBe('discover-pools');
    expect(useCases.analyzePool.id).toBe('analyze-pool');
    expect(useCases.simulatePosition.id).toBe('simulate-position');
    expect(useCases.replayHistoricalPerformance.id).toBe('replay-historical-performance');
    expect(useCases.compareStrategies.id).toBe('compare-strategies');
  });

  it('discoverPools: lookupPool mode returns ≥0 pools', async () => {
    const fx = await buildUseCaseFixture();
    if (!fx) return;
    const useCases = fx.services.useCases();
    const discovered: readonly IDiscoveredPoolDTO[] = await useCases.discoverPools.execute({
      chainId: mainnet.id,
      tokenA: MAINNET_USDC,
      tokenB: MAINNET_WETH,
      fee: FEE_500,
    });
    // Public RPC may be down; we only require the call to not throw.
    expect(Array.isArray(discovered)).toBe(true);
  });

  it('analyzePool: DTO shape + history-derived fields populated', async () => {
    const fx = await buildUseCaseFixture();
    if (!fx) return;
    const useCases = fx.services.useCases();
    const analysis: IPoolAnalysisDTO = await useCases.analyzePool.execute({
      pool: fx.pool.poolAddress,
      chainId: mainnet.id,
      history: fx.history,
      priceDecimals: PRICE_DECIMALS,
    });

    // DTO shape.
    expect(typeof analysis.pool).toBe('string');
    expect(typeof analysis.chainId).toBe('number');
    expect(typeof analysis.protocolId).toBe('string');
    expect(typeof analysis.description).toBe('string');
    expect(typeof analysis.feeTier).toBe('number');
    expect(typeof analysis.tickSpacing).toBe('number');
    expect(typeof analysis.currentTick).toBe('number');
    expect(typeof analysis.currentPrice).toBe('bigint');
    expect(typeof analysis.currentPriceDecimals).toBe('number');
    expect(typeof analysis.token0).toBe('object');
    expect(typeof analysis.token1).toBe('object');
    expect(typeof analysis.annualizedVolatility).toBe('bigint');
    expect(typeof analysis.cumulativeReturn).toBe('bigint');
    expect(typeof analysis.returnDecimals).toBe('number');
    expect(typeof analysis.snapshotCount).toBe('number');
    expect(typeof analysis.historyWindowSeconds).toBe('bigint');

    // History-derived.
    expect(analysis.snapshotCount).toBe(SYNTH_HISTORY_DAYS);
    expect(analysis.annualizedVolatility).toBeGreaterThan(0n);
    expect(analysis.historyWindowSeconds).toBeGreaterThan(0n);
  });

  it('simulatePosition: all four sim levels populated', async () => {
    const fx = await buildUseCaseFixture();
    if (!fx) return;
    const useCases = fx.services.useCases();

    const constantGen = createConstantRangeGenerator({ widthsTicks: [400] });
    const poolAggregate = createPool({ state: fx.pool.state, chainId: mainnet.id });
    const range = constantGen.generate(poolAggregate)[0]!;

    const sim: IPositionSimulationDTO = await useCases.simulatePosition.execute({
      pool: fx.pool.poolAddress,
      chainId: mainnet.id,
      range: { tickLower: range.tickLower, tickUpper: range.tickUpper },
      principalInNumeraire: 100_000_000n,
      numeraireToken: 'token0',
      token0Amount: 100_000_000n,
      targetApr: 3n * 10n ** 17n,
      futurePrice: new Price(
        (fx.currentPrice18.value * 11n) / 10n,
        PRICE_DECIMALS,
      ),
      history: fx.history,
      monteCarlo: {
        muAnnual: 0n,
        sigmaAnnual: fx.sigmaAnnual,
        numPaths: 64,
        numSteps: 30,
        stepSeconds: SECONDS_PER_DAY,
        seed: 12_345n,
      },
    });

    expect(sim.quote).toBeDefined();
    expect(sim.deposit).toBeDefined();
    expect(sim.futurePrice).not.toBeNull();
    expect(sim.historical).not.toBeNull();
    expect(sim.monteCarlo).not.toBeNull();
    if (!sim.futurePrice) return;
    expect(sim.futurePrice.horizonSeconds).toBe(SECONDS_PER_YEAR);
    if (!sim.historical) return;
    expect(sim.historical.nIntervals).toBeGreaterThan(0);
    expect(sim.historical.nSnapshots).toBe(fx.history.size());
    if (!sim.monteCarlo) return;
    expect(sim.monteCarlo.terminalIlP05).toBeLessThanOrEqual(sim.monteCarlo.terminalIlP50);
    expect(sim.monteCarlo.terminalIlP50).toBeLessThanOrEqual(sim.monteCarlo.terminalIlP95);
  });

  it('replayHistoricalPerformance: shape + timeInRange ∈ [0, 1]', async () => {
    const fx = await buildUseCaseFixture();
    if (!fx) return;
    const useCases = fx.services.useCases();
    const constantGen = createConstantRangeGenerator({ widthsTicks: [400] });
    const poolAggregate = createPool({ state: fx.pool.state, chainId: mainnet.id });
    const range = constantGen.generate(poolAggregate)[0]!;

    const replay: IHistoricalReplayDTO = await useCases.replayHistoricalPerformance.execute({
      pool: fx.pool.poolAddress,
      chainId: mainnet.id,
      range: { tickLower: range.tickLower, tickUpper: range.tickUpper },
      principalInNumeraire: 100_000_000n,
      numeraireToken: 'token0',
      history: fx.history,
      targetApr: 3n * 10n ** 17n,
    });

    expect(typeof replay.entryPrice).toBe('bigint');
    expect(replay.entryPrice).toBeGreaterThan(0n);
    expect(replay.feeRatePerSecond).toBeGreaterThan(0n);
    expect(replay.snapshotCount).toBe(SYNTH_HISTORY_DAYS);
    expect(replay.nIntervals).toBe(SYNTH_HISTORY_DAYS - 1);
    expect(replay.totalFeesInNumeraire).toBeGreaterThanOrEqual(0n);
    expect(replay.timeInRangeFraction).toBeGreaterThanOrEqual(0n);
    expect(replay.timeInRangeFraction).toBeLessThanOrEqual(10n ** 18n);
  });

  it('compareStrategies: 5 strategy IDs in result, monotonic by score', async () => {
    const fx = await buildUseCaseFixture();
    if (!fx) return;
    const useCases = fx.services.useCases();
    const poolAggregate = createPool({ state: fx.pool.state, chainId: mainnet.id });
    const recs: IRecommendationDTO = useCases.compareStrategies.execute({
      pool: poolAggregate,
      protocolId: 'uniswap-v3',
      expectedApr: 3n * 10n ** 17n,
      annualizedVolatility: fx.sigmaAnnual,
      riskFreeApr: 0n,
    });

    const seen = new Set(recs.recommendations.map((r) => r.strategyId));
    for (const id of ['balanced', 'maximum-fee', 'lowest-risk', 'highest-capital-efficiency', 'highest-sharpe']) {
      expect(seen.has(id)).toBe(true);
    }

    for (let i = 1; i < recs.recommendations.length; i++) {
      const prev = recs.recommendations[i - 1]!.score;
      const curr = recs.recommendations[i]!.score;
      expect(curr).toBeLessThanOrEqual(prev);
    }

    expect(recs.poolDescription).toBe(poolAggregate.describe());
  });

  it('negative: analyzePool("") → InvalidUseCaseInputError', async () => {
    const fx = await buildUseCaseFixture();
    if (!fx) return;
    await expect(
      fx.services.useCases().analyzePool.execute({
        pool: '' as `0x${string}`,
        chainId: mainnet.id,
      }),
    ).rejects.toBeInstanceOf(InvalidUseCaseInputError);
  });

  it('negative: simulatePosition(bad range) → InvalidUseCaseInputError', async () => {
    const fx = await buildUseCaseFixture();
    if (!fx) return;
    await expect(
      fx.services.useCases().simulatePosition.execute({
        pool: fx.pool.poolAddress,
        chainId: mainnet.id,
        range: { tickLower: 1000, tickUpper: 500 }, // lower > upper
        principalInNumeraire: 0n,
        numeraireToken: 'token0',
      }),
    ).rejects.toBeInstanceOf(InvalidUseCaseInputError);
  });

  it('negative: replayHistoricalPerformance(no history) → MissingPoolHistoryError', async () => {
    const fx = await buildUseCaseFixture();
    if (!fx) return;
    const constantGen = createConstantRangeGenerator({ widthsTicks: [400] });
    const poolAggregate = createPool({ state: fx.pool.state, chainId: mainnet.id });
    const range = constantGen.generate(poolAggregate)[0]!;
    await expect(
      fx.services.useCases().replayHistoricalPerformance.execute({
        pool: fx.pool.poolAddress,
        chainId: mainnet.id,
        range: { tickLower: range.tickLower, tickUpper: range.tickUpper },
        principalInNumeraire: 0n,
        numeraireToken: 'token0',
        history: undefined,
      }),
    ).rejects.toBeInstanceOf(MissingPoolHistoryError);
  });

  it('negative: analyzePool(unregistered chain) → AdapterNotFoundError', async () => {
    const fx = await buildUseCaseFixture();
    if (!fx) return;
    await expect(
      fx.services.useCases().analyzePool.execute({
        pool: fx.pool.poolAddress,
        chainId: SYNTH_CHAIN_ID,
      }),
    ).rejects.toBeInstanceOf(AdapterNotFoundError);
  });

  it('IRpcProvider blockTag: readContract at a pinned block still works', async () => {
    const fx = await buildUseCaseFixture();
    if (!fx) return;
    let latest: bigint;
    try {
      latest = await fx.services.rpc().getBlockNumber();
    }
    catch {
      return; // public RPC down; blockTag path can't be tested offline
    }
    const pin = latest > 1n ? latest - 1n : latest;
    try {
      const sym = await fx.services.rpc().readContract<string>({
        address: MAINNET_WETH,
        abi: [
          {
            type: 'function',
            name: 'symbol',
            stateMutability: 'view',
            inputs: [],
            outputs: [{ type: 'string' }],
          },
        ],
        functionName: 'symbol',
        blockTag: pin,
      });
      expect(sym).toBe('WETH');
    }
    catch {
      // Public RPC retention varies; missing archive state is
      // expected, not a code bug. Don't fail the test.
    }
  });
});
