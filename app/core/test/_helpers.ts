// app/core/test/_helpers.ts

/**
 * Shared helpers for the test suite. Filename begins with `_` so
 * Vitest's `*.test.ts` include glob never picks it up. Imported
 * by phase 5, 6, and 7 test files.
 */

import { bigintExp } from '@core/math';
import type { TAddress } from '@core/shared/types';
import { Price } from '@core/shared/value_objects';

import { PoolSnapshot } from '@core/domains/history';

import { PRICE_DECIMALS } from './test-constants';

export const SECONDS_PER_DAY = 86_400n;

/** Mirrors `SECONDS_PER_YEAR` from `@core/math/volatility.util.ts`. */
export const SECONDS_PER_YEAR_ABS = 31_557_600n;

/**
 * Deterministic 64-bit LCG. Identical to the one the math layer
 * uses internally (Monte Carlo PRNG).
 */
export function lcg(seed: bigint): bigint {
  return (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
}

/**
 * Build a synthetic `n`-day daily price history whose final
 * snapshot equals `referencePrice` exactly. The intermediate
 * prices follow a 12-uniform CLT normal with `dailySigmaPct`
 * standard deviation.
 *
 * Mirrors the helper that previously lived in
 * `scripts/smoke-test-phase{5,6,7}.ts`; centralised here so the
 * three phase tests share one implementation.
 */
export function buildSyntheticHistory(
  pool: TAddress,
  chainId: number,
  currentTick: number,
  currentLiquidity: bigint,
  currentSqrtPriceX96: bigint,
  days: number,
  dailySigmaPct: number,
  seed: bigint,
  referencePrice: bigint,
): readonly PoolSnapshot[] {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const startBlock = 21_000_000n;

  const ONE = 10n ** 18n;
  const snap: PoolSnapshot[] = [];

  let s = seed;
  const logReturns: bigint[] = [];
  let cumulativeLog = 0n;

  for (let i = 0; i < days; i++) {
    let z = 0;
    for (let j = 0; j < 12; j++) {
      s = lcg(s);
      z += Number(s >> 40n) / (1 << 24);
    }
    z -= 6; // CLT

    const noisePct = z * dailySigmaPct;
    const noiseScaled = BigInt(Math.round((noisePct / 100) * Number(ONE)));
    cumulativeLog += noiseScaled;
    logReturns.push(cumulativeLog);
  }

  const totalLog = logReturns.at(-1)!;

  for (let i = 0; i < days; i++) {
    const expArg = logReturns[i]! - totalLog;
    const expVal = bigintExp(expArg, 18);
    const priceBig = (referencePrice * expVal) / ONE;

    const ratio = Number(priceBig) / Number(referencePrice);
    const tickDelta = Math.round(Math.log(ratio) / Math.log(1.0001));
    const tick = currentTick + tickDelta;

    snap.push(new PoolSnapshot(
      pool,
      chainId,
      startBlock + BigInt(i * 1000),
      now - BigInt(days - 1 - i) * SECONDS_PER_DAY,
      currentSqrtPriceX96,
      tick,
      currentLiquidity,
      new Price(priceBig, PRICE_DECIMALS),
    ));
  }

  return snap;
}

/**
 * Pretty-print a `bigint` at the given scale as a percent string
 * (e.g. `510000000000000000n` at `VOLATILITY_SCALE` → "51.00%").
 */
export function fmtPct(v: bigint, scale: bigint): string {
  return `${(Number(v) / Number(scale) * 100).toFixed(2)}%`;
}
