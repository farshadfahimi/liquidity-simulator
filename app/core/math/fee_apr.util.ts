// app/core/math/fee_apr.util.ts

/**
 * Fee APR from pool turnover (TVL-ROADMAP.md §5.3).
 *
 *     poolFeeApr = (volume24h / tvl) × feeRate × 365
 *
 * This is the pool-level "if you provided the whole TVL as full-range
 * liquidity you would earn X% APR" estimate. Range-specific expected
 * APR (capital efficiency × P(in-range), §5.4) is layered on top of
 * it in the recommendation engine — not here.
 *
 * Conventions:
 *   - `volume24hUsd` and `tvlUsd` share `USD_DECIMALS` (6), so their ratio is
 *     scale-free (the 6-decimal scale cancels in the division).
 *   - `feeRate` is the *only* float input accepted here: a plain
 *     fraction, e.g. `0.0005` for a 0.05% tier (pass `pool.fee / 1e6`,
 *     since `pool.fee` is hundredths of a basis point). It is converted
 *     to 1e18 fixed-point immediately.
 *   - Output is at `APR_SCALE` (1e18 == 100%/yr).
 */

import { APR_SCALE } from './apr.util';

/** Days per year used to annualize daily rates (no leap days). */
export const DAYS_PER_YEAR = 365n;

/**
 * Annualize a daily rate (at `APR_SCALE`) by multiplying with the days
 * per year. Trivial, but keeps the "where did 365 come from" answer in
 * exactly one place.
 *
 * @param dailyRate - Rate per day at `APR_SCALE` (1e18 == 100%/day).
 * @param daysPerYear - Override the annualization window (default 365).
 * @throws When `dailyRate` is negative or `daysPerYear <= 0n`.
 */
export function annualizeDailyRate(
  dailyRate: bigint,
  daysPerYear: bigint = DAYS_PER_YEAR,
): bigint {
  if (dailyRate < 0n) {
    throw new Error(
      `annualizeDailyRate: dailyRate must be non-negative, got ${dailyRate}`,
    );
  }

  if (daysPerYear <= 0n) {
    throw new Error(
      `annualizeDailyRate: daysPerYear must be positive, got ${daysPerYear}`,
    );
  }

  return dailyRate * daysPerYear;
}

/**
 * Pool fee APR implied by a 24h turnover observation.
 *
 *     APR = (volume24hUsd / tvlUsd) × feeRate × 365
 *
 * Degradation rules (TVL-ROADMAP.md §5.3):
 *   - `tvlUsd <= 0n` → **throws**. There is no meaningful ratio; the
 *     caller must fall back to a prior APR *before* calling this.
 *   - `volume24hUsd === 0n` (unknown volume) → returns `0n`; the caller
 *     keeps its prior APR.
 *   - 24h-derived APRs are noisy by nature — callers must label them
 *     "24h-based, extrapolated" in the UI (and clamp absurd results
 *     per §8).
 *
 * @param volume24hUsd - Rolling 24h volume, USD at `USD_DECIMALS` (6).
 * @param tvlUsd - Pool TVL, USD at `USD_DECIMALS` (6).
 * @param feeRate - Fee tier as a plain fraction (`0.0005` for 0.05%).
 * @returns APR at `APR_SCALE` (1e18 == 100%/yr).
 * @throws When `tvlUsd <= 0n`, `volume24hUsd < 0n`, or `feeRate` is
 *   not a finite fraction in (0, 1).
 */
export function feeAprFromTurnover(
  volume24hUsd: bigint,
  tvlUsd: bigint,
  feeRate: number,
): bigint {
  if (tvlUsd <= 0n) {
    throw new Error(
      `feeAprFromTurnover: tvlUsd must be positive (caller must fall back to a prior APR first), got ${tvlUsd}`,
    );
  }

  if (volume24hUsd < 0n) {
    throw new Error(
      `feeAprFromTurnover: volume24hUsd must be non-negative, got ${volume24hUsd}`,
    );
  }

  if (!Number.isFinite(feeRate) || feeRate <= 0 || feeRate >= 1) {
    throw new Error(
      `feeAprFromTurnover: feeRate must be a finite fraction in (0, 1), got ${feeRate}`,
    );
  }

  // Unknown volume → no signal; the caller keeps its prior APR.
  if (volume24hUsd === 0n) {
    return 0n;
  }

  // Daily turnover ratio at APR_SCALE (the USD scales cancel).
  const dailyTurnover = (volume24hUsd * APR_SCALE) / tvlUsd;

  // feeRate → 1e18 fixed-point (the only float allowed at this boundary).
  const feeRateScaled = BigInt(Math.round(feeRate * Number(APR_SCALE)));

  // Daily fee yield at APR_SCALE.
  const dailyFeeRate = (dailyTurnover * feeRateScaled) / APR_SCALE;

  return annualizeDailyRate(dailyFeeRate);
}
