// app/core/math/virtual_reserves.util.ts

/**
 * Virtual-reserve math — the **on-chain TVL baseline**.
 *
 * A concentrated-liquidity pool has no "balances" to read: its value
 * lives in `liquidity` (the amount of virtual liquidity active at the
 * current tick). The standard approximation treats that active
 * liquidity as if it were a single full-range position, which yields
 * two virtual reserves:
 *
 *     amount0 = L × 2^96 / sqrtPriceX96
 *     amount1 = L × sqrtPriceX96 / 2^96
 *
 * This is the same convention DefiLlama uses when it values a V3 pool,
 * so the on-chain estimate and the external index are directly
 * comparable.
 *
 * Caveat (documented on purpose): the numbers only account for the
 * liquidity **active at the current tick**. Liquidity parked outside
 * the tick is invisible, so wide-range-heavy pools are understated.
 * Callers must label this tier as an estimate, never as a fact.
 *
 * Pure math — no I/O, no viem, no SDK.
 */

import { USD_DECIMALS } from '../shared/utils';

/** `2^96` — the Q96 fixed-point scale of V3's `sqrtPriceX96`. */
const Q96 = 2n ** 96n;

/** Scale of the USD **prices** fed into this module (1e18 == $1.00). */
const PRICE_DECIMALS = 18;

/**
 * The two virtual reserve legs of a pool, in **raw** token units
 * (i.e. scaled by each token's own `decimals`).
 */
export interface TVirtualReserves {
  /** Virtual amount of token0 (raw units of `token0.decimals`). */
  readonly amount0Raw: bigint;

  /** Virtual amount of token1 (raw units of `token1.decimals`). */
  readonly amount1Raw: bigint;
}

/**
 * Compute the virtual reserves of a CL pool from its active
 * liquidity and current sqrt price.
 *
 * @param liquidity - Pool `liquidity()` (raw bigint).
 * @param sqrtPriceX96 - Pool `sqrtPriceX96` (raw bigint).
 * @returns Both legs in raw token units.
 */
export function virtualReserves(
  liquidity: bigint,
  sqrtPriceX96: bigint,
): TVirtualReserves {
  if (liquidity < 0n) {
    throw new Error(
      `virtualReserves: liquidity must be non-negative, got ${liquidity}`,
    );
  }

  if (sqrtPriceX96 <= 0n) {
    throw new Error(
      `virtualReserves: sqrtPriceX96 must be positive, got ${sqrtPriceX96}`,
    );
  }

  return {
    amount0Raw: (liquidity * Q96) / sqrtPriceX96,
    amount1Raw: (liquidity * sqrtPriceX96) / Q96,
  };
}

/**
 * Value the virtual reserves of a pool in USD.
 *
 * @param liquidity - Pool `liquidity()` (raw bigint).
 * @param sqrtPriceX96 - Pool `sqrtPriceX96` (raw bigint).
 * @param token0Decimals - Decimals of token0 (e.g. 6 for USDC).
 * @param token1Decimals - Decimals of token1 (e.g. 18 for WETH).
 * @param token0Usd - USD price of token0 at 1e18 (e.g. `1e18` == $1).
 * @param token1Usd - USD price of token1 at 1e18.
 * @returns Total TVL in USD at `USD_DECIMALS` (1e6 == $1.00).
 */
export function virtualReservesInUsd(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number,
  token0Usd: bigint,
  token1Usd: bigint,
): bigint {
  if (!Number.isInteger(token0Decimals) || token0Decimals < 0) {
    throw new Error(
      `virtualReservesInUsd: token0Decimals must be a non-negative integer, got ${token0Decimals}`,
    );
  }

  if (!Number.isInteger(token1Decimals) || token1Decimals < 0) {
    throw new Error(
      `virtualReservesInUsd: token1Decimals must be a non-negative integer, got ${token1Decimals}`,
    );
  }

  if (token0Usd < 0n || token1Usd < 0n) {
    throw new Error(
      `virtualReservesInUsd: USD prices must be non-negative, got ${token0Usd}, ${token1Usd}`,
    );
  }

  const { amount0Raw, amount1Raw } = virtualReserves(liquidity, sqrtPriceX96);

  // Leg values in USD, still at the 1e18 price scale.
  const leg0Usd = (amount0Raw * token0Usd) / 10n ** BigInt(token0Decimals);
  const leg1Usd = (amount1Raw * token1Usd) / 10n ** BigInt(token1Decimals);

  // Re-scale the total from the 1e18 price scale down to the USD
  // amount scale (1e6).
  return (leg0Usd + leg1Usd) / 10n ** BigInt(PRICE_DECIMALS - USD_DECIMALS);
}
