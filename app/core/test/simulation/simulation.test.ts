// app/core/test/simulation/simulation.test.ts

/**
 * Phase 5 — Simulation Engine (was: `scripts/smoke-test-phase5.ts`).
 *
 * Exercises all four simulation levels (deposit, future price,
 * historical replay, Monte Carlo) on a live (when reachable) +
 * synthetic fallback USDC/WETH pool.
 */

import { mainnet } from 'viem/chains';

import { describe, expect, it } from 'vitest';

import { createRpcProvider } from '@core/providers/rpc';
import { createUniswapV3Adapter } from '@core/adapters/uniswap/v3';
import {
  createAnalyticsEngine,
  createConstantRangeGenerator,
  createDepositSimulation,
  createFuturePriceSimulation,
  createHistoricalReplaySimulation,
  createMonteCarloSimulation,
  createPool,
} from '@core/domains';
import { Position } from '@core/domains/position';
import { createPoolHistory } from '@core/domains/history';
import { Price, TickRange, sqrtPriceX96ToPrice, sqrtRatioAtTick } from '@core/shared/value_objects';
import { PRICE_DECIMALS } from '../test-constants';
import {
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR_ABS,
  buildSyntheticHistory,
} from '../_helpers';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';
const MAINNET_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const MAINNET_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
const FEE_500 = 500;

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

describe('Phase 5 — Simulation Engine', () => {
  it('deposit simulation: side, inRange, fillRatio, price band', async () => {
    const fixture = (await loadLivePool()) ?? syntheticFixture();
    const pool = createPool({ state: fixture.state, chainId: mainnet.id });

    const range = new TickRange(
      fixture.state.tick - 500 * fixture.state.tickSpacing,
      fixture.state.tick + 500 * fixture.state.tickSpacing,
    );

    const adapter = createUniswapV3Adapter({
      rpc: createRpcProvider({ chain: mainnet, rpcUrls: [RPC_URL] }),
    });
    let samplePosition: Position;
    try {
      const quote = await adapter.quotePosition(
        fixture.poolAddress,
        { tickLower: range.tickLower, tickUpper: range.tickUpper },
        1_000_000n,
      );
      samplePosition = Position.fromQuote(fixture.poolAddress, quote);
    }
    catch {
      samplePosition = Position.fromRaw(
        fixture.poolAddress,
        range.tickLower,
        range.tickUpper,
        fixture.state.token0.address,
        fixture.state.token1.address,
        1_000_000_000_000_000n,
        100_000_000n,
        50_000_000_000_000_000n,
      );
    }

    const depositSim = createDepositSimulation();
    const out = depositSim.run({ token0Amount: 1_000_000n }, pool, samplePosition);
    expect(['below', 'inside', 'above']).toContain(out.side);
    expect(out.fillRatio).toBeGreaterThanOrEqual(0n);
    expect(out.lowerPrice).toBeGreaterThan(0n);
    expect(out.upperPrice).toBeGreaterThan(out.lowerPrice);
  });

  it('future-price simulation: IL ≈ 0 at unchanged price; ±scenario sanity', async () => {
    const fixture = (await loadLivePool()) ?? syntheticFixture();
    const pool = createPool({ state: fixture.state, chainId: mainnet.id });
    const currentPrice18 = sqrtPriceX96ToPrice(
      fixture.state.sqrtPriceX96,
      fixture.state.token0.decimals,
      fixture.state.token1.decimals,
      PRICE_DECIMALS,
    );

    const futureSim = createFuturePriceSimulation();

    // Build a position (live-quoted if reachable, else synthetic).
    const adapter = createUniswapV3Adapter({
      rpc: createRpcProvider({ chain: mainnet, rpcUrls: [RPC_URL] }),
    });
    const range = new TickRange(
      fixture.state.tick - 500 * fixture.state.tickSpacing,
      fixture.state.tick + 500 * fixture.state.tickSpacing,
    );
    let futurePosition: Position;
    try {
      const quote = await adapter.quotePosition(
        fixture.poolAddress,
        { tickLower: range.tickLower, tickUpper: range.tickUpper },
        100_000_000n,
      );
      futurePosition = Position.fromQuote(fixture.poolAddress, quote);
    }
    catch {
      futurePosition = Position.fromRaw(
        fixture.poolAddress,
        range.tickLower,
        range.tickUpper,
        fixture.state.token0.address,
        fixture.state.token1.address,
        1_000_000_000_000_000n,
        100_000_000n,
        50_000_000_000_000_000n,
      );
    }
    const principalFuture = 100_000_000n;

    // Unchanged ⇒ IL ≈ 0.
    const unchanged = futureSim.run(
      {
        entryPrice: currentPrice18,
        futurePrice: currentPrice18,
        numeraireToken: 'token0',
        principalInNumeraire: principalFuture,
      },
      pool,
      futurePosition,
    );
    expect(Math.abs(Number(unchanged.il))).toBeLessThan(1e14);
    expect(unchanged.terminalValueInNumeraire).toBeGreaterThan(0n);

    // -10% ⇒ negative IL.
    const down = futureSim.run(
      {
        entryPrice: currentPrice18,
        futurePrice: new Price(
          (currentPrice18.value * 9n) / 10n,
          currentPrice18.decimals,
        ),
        numeraireToken: 'token0',
        principalInNumeraire: principalFuture,
      },
      pool,
      futurePosition,
    );
    expect(down.il).toBeLessThan(0n);
  });

  it('historical replay: round-trip APR matches the 30% target', async () => {
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
        30,
        3.0,
        12_345n,
        currentPrice18.value,
      ),
    });
    expect(history.size()).toBe(30);

    const replaySim = createHistoricalReplaySimulation({ history });

    const range = new TickRange(
      fixture.state.tick - 500 * fixture.state.tickSpacing,
      fixture.state.tick + 500 * fixture.state.tickSpacing,
    );
    const samplePosition = Position.fromRaw(
      fixture.poolAddress,
      range.tickLower,
      range.tickUpper,
      fixture.state.token0.address,
      fixture.state.token1.address,
      1_000_000_000_000_000n,
      100_000_000n,
      50_000_000_000_000_000n,
    );

    const APR_FRACTION_1e18 = 3n * 10n ** 17n; // 30%
    const feeRatePerSecond = APR_FRACTION_1e18 / SECONDS_PER_YEAR_ABS;
    const principalReplay = 100_000_000n;

    const out = replaySim.run(
      {
        entryPrice: history.earliest()!.price,
        feeRatePerSecond,
        principalInNumeraire: principalReplay,
        numeraireToken: 'token0',
      },
      pool,
      samplePosition,
    );

    // 30% APR target round-trip (1e18 == 100%).
    expect(out.apr).toBeGreaterThan(0n);
    // Allow 5% tolerance (synthetic 30-day daily history → APR
    // back-out is close to 30% but not exact because the simulation
    // accumulates per-step fees with the in-range mask).
    const target = 3n * 10n ** 17n;
    const tolerance = target / 20n; // 5%
    expect(out.apr).toBeGreaterThan(target - tolerance);
    expect(out.apr).toBeLessThan(target + tolerance);
    // Sanity: timeInRange ∈ [0, 1].
    expect(out.timeInRangeFraction).toBeGreaterThanOrEqual(0n);
    expect(out.timeInRangeFraction).toBeLessThanOrEqual(10n ** 18n);
  });

  it('Monte Carlo: p5 ≤ p50 ≤ p95 ordering, probInRange ∈ [0, 1]', async () => {
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
        30,
        3.0,
        12_345n,
        currentPrice18.value,
      ),
    });
    const analytics = createAnalyticsEngine();
    const vol = analytics.volatilityFromHistory(history);
    const sigmaAnnual = vol?.volAnnual ?? 5n * 10n ** 17n;

    const mcSim = createMonteCarloSimulation();
    const range = new TickRange(
      fixture.state.tick - 500 * fixture.state.tickSpacing,
      fixture.state.tick + 500 * fixture.state.tickSpacing,
    );
    const samplePosition = Position.fromRaw(
      fixture.poolAddress,
      range.tickLower,
      range.tickUpper,
      fixture.state.token0.address,
      fixture.state.token1.address,
      1_000_000_000_000_000n,
      100_000_000n,
      50_000_000_000_000_000n,
    );
    const APR_FRACTION_1e18 = 3n * 10n ** 17n;
    const feeRatePerSecond = APR_FRACTION_1e18 / SECONDS_PER_YEAR_ABS;

    const out = mcSim.run(
      {
        muAnnual: 0n,
        sigmaAnnual,
        numPaths: 200,
        numSteps: 30,
        stepSeconds: SECONDS_PER_DAY,
        seed: 999_999n,
        entryPrice: currentPrice18,
        feeRatePerSecond,
        principalInNumeraire: 100_000_000n,
        numeraireToken: 'token0',
      },
      pool,
      samplePosition,
    );

    const s = out.summary;
    expect(s.numPaths).toBe(200);
    expect(s.p5FinalIl).toBeLessThanOrEqual(s.p50FinalIl);
    expect(s.p50FinalIl).toBeLessThanOrEqual(s.p95FinalIl);
    expect(s.p5Apr).toBeLessThanOrEqual(s.p50Apr);
    expect(s.p50Apr).toBeLessThanOrEqual(s.p95Apr);
    expect(s.probInRange).toBeGreaterThanOrEqual(0n);
    expect(s.probInRange).toBeLessThanOrEqual(10n ** 18n);
  });
});
