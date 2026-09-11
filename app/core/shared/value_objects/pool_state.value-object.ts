// app/core/shared/value_objects/pool_state.value-object.ts

import type { TAddress } from '../types';
import type { TToken } from '../types';
import { Price } from './price.value-object';
import type { TPoolState } from '../../adapters/types';

/**
 * Immutable value object wrapping a live pool state. Acts as the
 * canonical "current state of a pool" handle inside the domain layer.
 * Doesn't expose `sqrtPriceX96` directly — callers use `currentPrice()`
 * to get a {@link Price} (which is what the rest of Core consumes).
 */
export class PoolStateVO {
  readonly pool: TAddress;

  readonly token0: TToken;

  readonly token1: TToken;

  readonly fee: number;

  readonly tickSpacing: number;

  readonly sqrtPriceX96: bigint;

  readonly tick: number;

  readonly liquidity: bigint;

  readonly feeGrowthGlobal0X128: bigint;

  readonly feeGrowthGlobal1X128: bigint;

  constructor(state: TPoolState) {
    this.pool = state.pool;
    this.token0 = state.token0;
    this.token1 = state.token1;
    this.fee = state.fee;
    this.tickSpacing = state.tickSpacing;
    this.sqrtPriceX96 = state.sqrtPriceX96;
    this.tick = state.tick;
    this.liquidity = state.liquidity;
    this.feeGrowthGlobal0X128 = state.feeGrowthGlobal0X128;
    this.feeGrowthGlobal1X128 = state.feeGrowthGlobal1X128;
  }

  /**
   * Current price of `token1` denominated in `token0`, scaled to
   * `decimals` (defaults to 18). E.g. on USDC/WETH pools the result
   * is WETH-in-USDC if token0 = USDC.
   */
  currentPrice(decimals: number = 18): Price {
    return sqrtPriceX96ToPrice(
      this.sqrtPriceX96,
      this.token0.decimals,
      this.token1.decimals,
      decimals,
    );
  }
}

/**
 * Convert `sqrtPriceX96` to a {@link Price} at `decimals` of precision.
 *
 * Math:
 *   The V3 invariant is `sqrtPriceX96 = sqrt(price_raw) * 2^96`,
 * where `price_raw = token1_raw / token0_raw` is the *raw*
 * (smallest-unit) ratio of token1 to token0. So:
 *
 *   price_raw = sqrtPriceX96^2 / 2^192.
 *
 * To return a `Price` whose `value / 10^decimals == price_human`
 * (the human-ratio `token1_human / token0_human`), we need:
 *
 *   price_human = price_raw * 10^(token0Decimals - token1Decimals)
 *   value       = price_human * 10^decimals
 *               = price_raw * 10^(token0Decimals - token1Decimals + decimals)
 *
 * Implementation uses bigint squares to avoid floating-point error.
 *
 * @param sqrtPriceX96 - Raw sqrtPriceX96 from V3's `slot0`.
 * @param token0Decimals - Decimals of token0 (e.g. 6 for USDC).
 * @param token1Decimals - Decimals of token1 (e.g. 18 for WETH).
 * @param decimals - Output scale of the returned Price (default 18).
 */
export function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number,
  decimals: number = 18,
): Price {
  if (sqrtPriceX96 < 0n) {
    throw new Error(
      `sqrtPriceX96 must be non-negative, got ${sqrtPriceX96}`,
    );
  }

  if (token0Decimals < 0 || !Number.isInteger(token0Decimals)) {
    throw new Error(
      `sqrtPriceX96ToPrice: token0Decimals invalid: ${token0Decimals}`,
    );
  }

  if (token1Decimals < 0 || !Number.isInteger(token1Decimals)) {
    throw new Error(
      `sqrtPriceX96ToPrice: token1Decimals invalid: ${token1Decimals}`,
    );
  }

  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new Error(
      `sqrtPriceX96ToPrice: decimals invalid: ${decimals}`,
    );
  }

  const Q96 = 2n ** 96n;
  const Q192 = Q96 * Q96;

  // targetScale = token0Decimals - token1Decimals + decimals.
  //
  // For USDC(6) / WETH(18) with decimals=18: targetScale = 6 - 18 + 18 = 6.
  // So value = price_raw * 10^6 ≈ 4e8 * 1e6 = 4e14. ✓
  const targetScale = token0Decimals - token1Decimals + decimals;

  const numerator = sqrtPriceX96 * sqrtPriceX96;
  const scaled = targetScale >= 0
    ? numerator * 10n ** BigInt(targetScale)
    : numerator / 10n ** BigInt(-targetScale);

  const priceValue = scaled / Q192;

  return new Price(priceValue, decimals);
}
