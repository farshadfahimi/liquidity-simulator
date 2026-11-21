// app/core/test/math/virtual_reserves.test.ts

/**
 * TVL roadmap slice 1 — virtual-reserve math (the on-chain TVL
 * baseline).
 *
 * Everything here is pure: no RPC, no provider, no network. The
 * invariants are the ones DefiLlama itself relies on when it values
 * a V3 pool, so the two tiers stay comparable:
 *
 *   amount0 = L × 2^96 / sqrtPriceX96
 *   amount1 = L × sqrtPriceX96 / 2^96
 */

import { describe, expect, it } from 'vitest';

import {
  sqrtRatioAtTick,
  virtualReserves,
  virtualReservesInUsd,
} from '@core/math';
import { USD_DECIMALS } from '@core/shared/utils';

const Q96 = 2n ** 96n;
const Q192 = Q96 * Q96;

/** Absolute difference between two bigints. */
function absDiff(a: bigint, b: bigint): bigint {
  return a >= b ? a - b : b - a;
}

describe('virtual reserves', () => {
  it('returns equal legs when the raw price is 1:1', () => {
    const reserves = virtualReserves(10n ** 18n, Q96);

    expect(reserves.amount0Raw).toBe(10n ** 18n);
    expect(reserves.amount1Raw).toBe(10n ** 18n);
  });

  it('throws on a negative liquidity', () => {
    expect(() => virtualReserves(-1n, Q96)).toThrow(/liquidity/);
  });

  it('throws on a zero sqrtPriceX96', () => {
    expect(() => virtualReserves(1n, 0n)).toThrow(/sqrtPriceX96/);
  });

  it('throws on a negative sqrtPriceX96', () => {
    expect(() => virtualReserves(1n, -Q96)).toThrow(/sqrtPriceX96/);
  });

  it('keeps the two legs symmetric around the current price', () => {
    const tick = 100_000;
    const sqrtPriceX96 = sqrtRatioAtTick(tick);
    const { amount0Raw, amount1Raw } = virtualReserves(10n ** 18n, sqrtPriceX96);

    // price_raw = sqrtPriceX96² / 2^192 (token1 raw per token0 raw) and,
    // by construction, amount1 / amount0 === price_raw. Compare the two
    // ratios with a 1e-6 relative tolerance (the truncation of the two
    // bigint divisions is the only source of error).
    const priceRawScaled = (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) / Q192;
    const ratioFromReserves = (amount1Raw * 10n ** 18n) / amount0Raw;

    expect(absDiff(ratioFromReserves, priceRawScaled) * 1_000_000n)
      .toBeLessThanOrEqual(priceRawScaled);
  });

  it('values the reserves in USD at the hand-computed amount', () => {
    // L = 1e18 at a 1:1 raw price → 1 token0 + 1 token1 (18 decimals).
    // At $2 and $3 the pool is worth exactly $5.
    const usd = virtualReservesInUsd(
      10n ** 18n,
      Q96,
      18,
      18,
      2n * 10n ** 18n,
      3n * 10n ** 18n,
    );

    expect(usd).toBe(5n * 10n ** BigInt(USD_DECIMALS));
  });

  it('applies the token decimals when valuing the legs', () => {
    // L = 1e18 at a 1:1 raw price, USDC (6 dec) / WETH (18 dec):
    //   leg0 = 1e18 raw USDC = 1e12 USDC  → $1e12
    //   leg1 = 1e18 raw WETH = 1 WETH     → $3,000
    const usd = virtualReservesInUsd(
      10n ** 18n,
      Q96,
      6,
      18,
      10n ** 18n,
      3000n * 10n ** 18n,
    );

    expect(usd).toBe((10n ** 12n + 3000n) * 10n ** BigInt(USD_DECIMALS));
  });

  it('returns zero TVL for an empty pool', () => {
    const usd = virtualReservesInUsd(
      0n,
      Q96,
      18,
      18,
      10n ** 18n,
      10n ** 18n,
    );

    expect(usd).toBe(0n);
  });

  it('throws on invalid token decimals', () => {
    expect(() => virtualReservesInUsd(1n, Q96, -1, 18, 0n, 0n))
      .toThrow(/token0Decimals/);
    expect(() => virtualReservesInUsd(1n, Q96, 18, 1.5, 0n, 0n))
      .toThrow(/token1Decimals/);
  });

  it('throws on a negative USD price', () => {
    expect(() => virtualReservesInUsd(1n, Q96, 18, 18, -1n, 0n))
      .toThrow(/prices/);
  });
});
