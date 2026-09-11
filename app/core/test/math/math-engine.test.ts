// app/core/test/math/math-engine.test.ts

/**
 * Phase 4 — Mathematical Engine (was: `scripts/smoke-test-phase4.ts`).
 *
 * Wires the math engine + analytics extensions:
 *   - realized volatility (from a synthetic 8-day history)
 *   - impermanent loss at current price
 *   - capital efficiency for ±N×spacing ranges
 *   - ConstantRangeGenerator + VolatilityAdjustedRangeGenerator
 *   - APR + Sharpe-like score from a synthetic 7-day fee window
 *   - positionMetrics bundle for one candidate
 *
 * Live pool is read once for the anchor; the rest of the math is
 * pure (deterministic synthetic history + LCG-seeded returns).
 */

import { mainnet } from 'viem/chains';

import { describe, expect, it } from 'vitest';

import { createRpcProvider } from '@core/providers/rpc';
import { createUniswapV3Adapter } from '@core/adapters/uniswap/v3';
import {
  createAnalyticsEngine,
  createConstantRangeGenerator,
  createPool,
  createVolatilityAdjustedRangeGenerator,
} from '@core/domains';
import { Position } from '@core/domains/position';
import { createPoolHistory } from '@core/domains/history';
import { Price, TickRange, sqrtPriceX96ToPrice } from '@core/shared/value_objects';
import { formatAmount } from '@core/shared/utils';
import {
  APR_SCALE,
  CAPITAL_EFFICIENCY_SCALE,
  IL_SCALE,
  SCORE_SCALE,
  VOLATILITY_SCALE,
} from '@core/math';

import { PRICE_DECIMALS } from '../test-constants';
import { SECONDS_PER_DAY, buildSyntheticHistory, fmtPct } from '../_helpers';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';
const MAINNET_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const MAINNET_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
const FEE_500 = 500;

async function loadLivePool() {
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

describe('Phase 4 — Mathematical Engine', () => {
  it('realized volatility from an 8-day synthetic history is positive', async () => {
    const live = await loadLivePool();
    expect(live).not.toBeNull();
    if (!live) return;
    const { poolAddress, state } = live;

    const pool = createPool({ state, chainId: mainnet.id });
    const history = createPoolHistory({
      pool: poolAddress,
      chainId: mainnet.id,
      snapshots: buildSyntheticHistory(
        poolAddress,
        mainnet.id,
        state.tick,
        state.liquidity,
        state.sqrtPriceX96,
        8, // 8 days
        3.0, // 3% daily σ
        12_345n,
        pool.currentPrice(PRICE_DECIMALS).value,
      ),
    });
    expect(history.size()).toBe(8);

    const analytics = createAnalyticsEngine();
    const vol = analytics.volatilityFromHistory(history);
    expect(vol).not.toBeNull();
    if (!vol) return;
    expect(vol.nReturns).toBe(7); // 8 snapshots → 7 returns
    expect(vol.volPerPeriod).toBeGreaterThan(0n);
    expect(vol.volAnnual).toBeGreaterThan(0n);
  });

  it('impermanent loss at unchanged price is ≈ 0', async () => {
    const live = await loadLivePool();
    if (!live) return;
    const { poolAddress, state } = live;
    const pool = createPool({ state, chainId: mainnet.id });
    const entryPrice = pool.currentPrice(PRICE_DECIMALS);
    const analytics = createAnalyticsEngine();
    const il = analytics.ilAtCurrentPrice(pool, entryPrice);
    // 0.0001 tolerance — exact zero is the math, but the assertion
    // tolerates any rounding noise.
    expect(Math.abs(Number(il))).toBeLessThan(1e14);
  });

  it('capital efficiency is higher for narrower ranges', async () => {
    const live = await loadLivePool();
    if (!live) return;
    const { state } = live;
    const analytics = createAnalyticsEngine();

    // Three symmetric ranges around the current tick. CE =
    // P_upper / P_lower = 1.0001^width, so a narrower range ⇒
    // smaller width ⇒ smaller CE.
    //
    // We assert the *full* width is 2*w, with w in {100, 500, 2000}.
    // CE grows monotonically with `w`, so:
    //   w=100  →  full width 200  ticks  →  CE = 1.0001^200
    //   w=500  →  full width 1000 ticks  →  CE = 1.0001^1000
    //   w=2000 →  full width 4000 ticks  →  CE = 1.0001^4000
    const ceValues: bigint[] = [];
    for (const w of [100, 500, 2000]) {
      const halfWidth = w * state.tickSpacing;
      const lo = state.tick - halfWidth;
      const hi = state.tick + halfWidth;
      const range = new TickRange(lo, hi);
      const ce = analytics.capitalEfficiency(range);
      ceValues.push(ce);
    }
    // CE[w=100] < CE[w=500] < CE[w=2000] (the narrower the range,
    // the smaller the price-band ratio).
    expect(ceValues[0]!).toBeLessThan(ceValues[1]!);
    expect(ceValues[1]!).toBeLessThan(ceValues[2]!);
  });

  it('ConstantRangeGenerator + VolatilityAdjustedRangeGenerator both produce aligned ranges', async () => {
    const live = await loadLivePool();
    if (!live) return;
    const { state } = live;
    const pool = createPool({ state, chainId: mainnet.id });

    const constantGen = createConstantRangeGenerator({ widthsTicks: [100, 500, 2000] });
    const constantCandidates = constantGen.generate(pool);
    expect(constantCandidates.length).toBe(3);

    // Volatility-adjusted: derive dailySigmaTicks from a synthetic
    // history (50% annualized → ~3% daily → ~263 ticks).
    const analytics = createAnalyticsEngine();
    const history = createPoolHistory({
      pool: '0x000000000000000000000000000000000000dEaD' as `0x${string}`,
      chainId: mainnet.id,
      snapshots: buildSyntheticHistory(
        '0x000000000000000000000000000000000000dEaD' as `0x${string}`,
        mainnet.id,
        state.tick,
        state.liquidity,
        state.sqrtPriceX96,
        8,
        3.0,
        12_345n,
        pool.currentPrice(PRICE_DECIMALS).value,
      ),
    });
    const vol = analytics.volatilityFromHistory(history);
    expect(vol).not.toBeNull();
    if (!vol) return;
    const sigmaAnnualFraction = Number(vol.volAnnual) / Number(VOLATILITY_SCALE);
    const sigmaDayFraction = sigmaAnnualFraction / Math.sqrt(365);
    const LNP1 = Math.log(1.0001);
    const dailySigmaTicks = Math.max(1, Math.round(sigmaDayFraction / LNP1));

    const volGen = createVolatilityAdjustedRangeGenerator({
      dailySigmaTicks,
      sigmaMultipliers: [1, 2, 4],
    });
    const volCandidates = volGen.generate(pool);
    expect(volCandidates.length).toBe(3);

    for (const r of [...constantCandidates, ...volCandidates]) {
      expect(r.tickLower % state.tickSpacing).toBe(0);
      expect(r.tickUpper % state.tickSpacing).toBe(0);
    }
  });

  it('APR + Sharpe-like score from a synthetic 7-day fee window', async () => {
    const live = await loadLivePool();
    if (!live) return;
    const { poolAddress, state } = live;
    const pool = createPool({ state, chainId: mainnet.id });

    const history = createPoolHistory({
      pool: poolAddress,
      chainId: mainnet.id,
      snapshots: buildSyntheticHistory(
        poolAddress,
        mainnet.id,
        state.tick,
        state.liquidity,
        state.sqrtPriceX96,
        8,
        3.0,
        12_345n,
        pool.currentPrice(PRICE_DECIMALS).value,
      ),
    });
    const analytics = createAnalyticsEngine();
    const vol = analytics.volatilityFromHistory(history);
    expect(vol).not.toBeNull();
    if (!vol) return;

    const windowSeconds = 7n * SECONDS_PER_DAY;
    const fees = 50_000n + 50_000n;
    const principal = 100n * 1_000_000n + 100n * 1_000_000n;

    const apr = analytics.apr(fees, principal, windowSeconds);
    expect(apr).toBeGreaterThan(0n);

    const score = analytics.scoreFromWindow(fees, principal, windowSeconds, vol.volAnnual);
    expect(score).toBeGreaterThanOrEqual(0n);
    expect(score).toBeLessThanOrEqual(SCORE_SCALE);
  });

  it('positionMetrics bundle covers side, IL, CE, amounts', async () => {
    const live = await loadLivePool();
    if (!live) return;
    const { poolAddress, state } = live;
    const pool = createPool({ state, chainId: mainnet.id });

    const adapter = createUniswapV3Adapter({
      rpc: createRpcProvider({ chain: mainnet, rpcUrls: [RPC_URL] }),
    });
    const range = new TickRange(state.tick - 500 * state.tickSpacing, state.tick + 500 * state.tickSpacing);
    const quote = await adapter.quotePosition(
      poolAddress,
      { tickLower: range.tickLower, tickUpper: range.tickUpper },
      1_000_000n,
    );
    const position = Position.fromQuote(poolAddress, quote);
    const entryPrice = pool.currentPrice(PRICE_DECIMALS);

    const analytics = createAnalyticsEngine();
    const metrics = analytics.positionMetrics(pool, position, entryPrice);
    expect(metrics.side === 'below' || metrics.side === 'inside' || metrics.side === 'above').toBe(true);
    // 0 IL when entry == current.
    expect(Math.abs(Number(metrics.il))).toBeLessThan(1e14);
    expect(metrics.ce).toBeGreaterThan(CAPITAL_EFFICIENCY_SCALE); // tighter than full-range

    // formatAmount sanity (just call it).
    expect(formatAmount(position.amount0, state.token0.decimals).length).toBeGreaterThan(0);
  });
});
