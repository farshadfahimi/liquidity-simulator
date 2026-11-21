// app/core/test/domains/pool/virtual_reserves.test.ts

/**
 * TVL roadmap slice 1 — the on-chain TVL baseline at the domain
 * level.
 *
 * Covers the three domain entry points that need no network at all:
 *
 *   - `Pool.virtualReserves()` — the two virtual reserve legs.
 *   - `Pool.tvlToken0()` — the pool value denominated in token0.
 *   - `AnalyticsEngine.poolTvlOnChain()` — the same value in USD.
 *   - `AnalyticsEngine.positionShareOfPool()` — the exit-impact guard.
 *
 * The fixture is a synthetic USDC/WETH pool at tick 0 (a 1:1 *raw*
 * ratio), which makes every expected value hand-computable.
 */

import { describe, expect, it } from 'vitest';

import { createAnalyticsEngine, createPool } from '@core/domains';
import { virtualReserves } from '@core/math';
import { formatUsd, USD_DECIMALS } from '@core/shared/utils';

import {
  STUB_LIQUIDITY,
  buildPoolState,
} from '../../_fixtures/pool_state_fixture';

/** $1 in USD_DECIMALS. */
const ONE_USD = 10n ** BigInt(USD_DECIMALS);

/** $3,000 in USD_DECIMALS. */
const THREE_THOUSAND_USD = 3000n * ONE_USD;

describe('Pool — virtual reserves', () => {
  it('exposes the virtual reserve legs of the active liquidity', () => {
    const state = buildPoolState({ liquidity: STUB_LIQUIDITY });
    const pool = createPool({ state, chainId: 1 });

    const reserves = pool.virtualReserves();

    // Tick 0 ⇒ sqrtPriceX96 == 2^96 ⇒ both legs equal the liquidity.
    expect(reserves.amount0Raw).toBe(STUB_LIQUIDITY);
    expect(reserves.amount1Raw).toBe(STUB_LIQUIDITY);
    expect(reserves).toEqual(virtualReserves(state.liquidity, state.sqrtPriceX96));
  });

  it('values the pool in token0 units', () => {
    const state = buildPoolState({ liquidity: STUB_LIQUIDITY });
    const pool = createPool({ state, chainId: 1 });

    // Hand-computed at tick 0 (1:1 raw ratio, USDC 6 dec / WETH 18 dec):
    //   leg0 = 1e12 raw USDC = 1e6 USDC
    //   leg1 = 1e12 raw WETH = 1e-6 WETH; at 1e-12 WETH per USDC
    //         that is 1e6 USDC
    //   total = 2e6 USDC → 2e24 at 18 decimals.
    const tvl = pool.tvlToken0();

    expect(tvl.decimals).toBe(18);
    expect(tvl.value).toBe(2_000_000n * 10n ** 18n);
  });

  it('values the pool in token0 units at a lower scale', () => {
    const state = buildPoolState({ liquidity: STUB_LIQUIDITY });
    const pool = createPool({ state, chainId: 1 });

    const tvl = pool.tvlToken0(6);

    expect(tvl.decimals).toBe(6);
    expect(tvl.value).toBe(2_000_000n * 10n ** 6n);
  });
});

describe('AnalyticsEngine — on-chain TVL', () => {
  it('values the pool in USD with the supplied token prices', () => {
    const state = buildPoolState({ liquidity: STUB_LIQUIDITY });
    const pool = createPool({ state, chainId: 1 });
    const analytics = createAnalyticsEngine();

    // Hand-computed:
    //   leg0 = 1e12 raw USDC = 1e6 USDC  → $1,000,000
    //   leg1 = 1e12 raw WETH = 1e-6 WETH → $0.003 (at $3,000/WETH)
    //   total = $1,000,000.003 — the sub-cent tail is kept in the
    //   bigint amount but rounded away for display.
    const tvl = analytics.poolTvlOnChain(
      pool,
      10n ** 18n, // $1 per token0 (1e18 price scale)
      3000n * 10n ** 18n, // $3,000 per token1
    );

    expect(tvl).toBe(1_000_000n * ONE_USD + 3_000n);
    expect(formatUsd(tvl)).toBe('1,000,000.00');
  });

  it('reports a zero TVL for a pool without active liquidity', () => {
    const state = buildPoolState({ liquidity: 0n });
    const pool = createPool({ state, chainId: 1 });
    const analytics = createAnalyticsEngine();

    expect(analytics.poolTvlOnChain(pool, 10n ** 18n, 10n ** 18n)).toBe(0n);
  });
});

describe('AnalyticsEngine — position share of pool', () => {
  it('reports the share of the pool a notional represents', () => {
    const analytics = createAnalyticsEngine();

    // $1,000 in a $1,000,000 pool → 0.1% of the pool.
    const share = analytics.positionShareOfPool(1000n * ONE_USD, 1_000_000n * ONE_USD);

    expect(share).toBe(10n ** 15n); // 0.001 at SCORE_SCALE == 0.1%
  });

  it('returns no share when the pool TVL is unknown', () => {
    const analytics = createAnalyticsEngine();

    expect(analytics.positionShareOfPool(1000n * ONE_USD, 0n)).toBe(0n);
  });

  it('throws on a negative notional or TVL', () => {
    const analytics = createAnalyticsEngine();

    expect(() => analytics.positionShareOfPool(-1n, ONE_USD)).toThrow(/notionalUsd/);
    expect(() => analytics.positionShareOfPool(ONE_USD, -1n)).toThrow(/tvlUsd/);
  });
});
