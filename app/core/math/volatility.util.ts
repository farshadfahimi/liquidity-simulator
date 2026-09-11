// app/core/math/volatility.util.ts

/**
 * Realized volatility estimation from a series of price observations.
 *
 * Given a chronological list of (price, timestamp) pairs, compute:
 *
 *   1. Log returns: `r_i = ln(p_{i+1} / p_i)`
 *   2. Sample variance: `σ² = Σ(r_i − μ)² / (n − 1)`
 *   3. Annualize: `σ_ann = σ_period * sqrt(secondsPerYear / meanΔt)`
 *
 * For a CL-AMM project we treat timestamps in *seconds* (V3 emits
 * block.timestamp in seconds since epoch). Defaults assume the
 * observations are sampled approximately uniformly; if they aren't,
 * the caller should pass `secondsPerYear` matching the typical
 * observation cadence.
 *
 * All outputs are scaled bigints at `VOLATILITY_SCALE` (1e18 == 100%
 * annual vol, i.e. 1e18 == 1.0 == 100%).
 *
 * Numerics:
 *   - `ln(...)` is computed via a fixed-point bigint helper
 *     `bigintLn(value, decimals)` with accuracy ≈ 1e-4 relative,
 *     more than enough for vol estimation.
 *   - `sqrt(...)` is `bigintSqrtFloor` from `il.util.ts` (re-exported
 *     here for callers that only need the vol module).
 */

import { Price } from '../shared/value_objects';
import { bigintSqrtFloor } from './il.util';

/** Bigint scale used for volatility outputs (1e18 == 100%). */
export const VOLATILITY_SCALE = 1_000_000_000_000_000_000n; // 1e18

/** Seconds in a typical year (365.25 days × 86_400). */
export const SECONDS_PER_YEAR = 31_557_600n;

/** Re-export for callers that need sqrt outside this module. */
export { bigintSqrtFloor };

/** Internal scale used for log returns. */
const LN_SCALE = 1_000_000_000_000_000_000n; // 1e18

/** `ln(2)` at `LN_SCALE` precision: floor(0.6931471805599453 * 1e18). */
const LN2_AT_SCALE = 693147180559945309n;

/**
 * Compute `ln(value / 10^decimals)` as a bigint at `LN_SCALE`
 * precision (1e18 == 1.0).
 *
 * Implementation:
 *   1. Range-reduce `value / 10^d` into [0.5, 2) by dividing or
 *      multiplying by powers of 2 (track the exponent `k`).
 *   2. Compute `y = (n/target) - 1 ∈ [-0.5, 1.0)`.
 *   3. Use Taylor series:
 *        ln(1+y) ≈ y − y²/2 + y³/3 − y⁴/4 + y⁵/5 − y⁶/6
 *   4. Add `k * ln(2)` to undo the range reduction.
 *
 * Accuracy is ~1e-4 relative for `y ∈ [-0.5, 1.0)` with 6 terms,
 * which is sufficient for vol estimation at 1e18 scale.
 */
function bigintLn(value: bigint, decimals: number): bigint {
  if (value <= 0n) {
    throw new Error(`bigintLn requires a positive input, got ${value}`);
  }

  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new Error(`bigintLn decimals must be a non-negative integer, got ${decimals}`);
  }

  const target = 10n ** BigInt(decimals); // 10^d
  // Taylor converges for |y| < 1 (slowly at the boundary). Force y
  // well into (-0.5, 0.5) by range-reducing into [target * 3/4,
  // target * 5/4) i.e. n ∈ [0.75*target, 1.25*target).
  const upper = (target * 5n) / 4n;
  const lower = (target * 3n) / 4n;

  // Step 1: divide/multiply by 2 until n ∈ [lower, upper).
  let k = 0;
  let n = value;

  while (n >= upper) {
    n /= 2n;
    k += 1;
  }

  while (n < lower) {
    n *= 2n;
    k -= 1;
  }

  // Step 2: y = n/target − 1, in [−0.5, 1.0).
  // We carry everything in `LN_SCALE` precision (integer math).
  const y = ((n - target) * LN_SCALE) / target;

  // Step 3: Taylor at LN_SCALE precision.
  const Y = y;
  const Y2 = (Y * Y) / LN_SCALE;
  const Y3 = (Y2 * Y) / LN_SCALE;
  const Y4 = (Y3 * Y) / LN_SCALE;
  const Y5 = (Y4 * Y) / LN_SCALE;
  const Y6 = (Y5 * Y) / LN_SCALE;

  const lnZ =
    Y
    - Y2 / 2n
    + Y3 / 3n
    - Y4 / 4n
    + Y5 / 5n
    - Y6 / 6n;

  // Step 4: ln(value) = ln(n/target) + k·ln(2).
  // We divided n by 2^k, so ln(value) = ln(n) + k·ln(2).
  return lnZ + BigInt(k) * LN2_AT_SCALE;
}

/**
 * A single price observation used as input to volatility estimation.
 * `decimals` is needed so log() math is consistent across observations
 * with different decimal scales.
 */
export interface IPriceObservation {
  readonly price: bigint;
  readonly decimals: number;
  readonly timestamp: bigint; // unix seconds
}

/**
 * Result of {@link realizedVolatility}.
 *
 * - `volAnnual` — annualized volatility at `VOLATILITY_SCALE`
 *   (1e18 == 100%).
 * - `volPerPeriod` — volatility per observation interval (same scale).
 * - `meanDt` — mean Δt between observations in seconds.
 * - `nReturns` — number of log returns used.
 */
export interface IVolatilityResult {
  readonly volAnnual: bigint;
  readonly volPerPeriod: bigint;
  readonly meanDt: bigint;
  readonly nReturns: number;
}

/**
 * Compute realized (log-return) volatility from a series of price
 * observations. Observations must be in chronological order
 * (non-decreasing timestamps). At least 2 observations are required.
 *
 * Observations must share the same `decimals`.
 *
 * @param observations - Chronological price observations.
 * @param secondsPerYear - Override seconds-per-year for annualization
 *   (defaults to {@link SECONDS_PER_YEAR} = 31_557_600). Useful for
 *   test fixtures or non-calendar periods.
 */
export function realizedVolatility(
  observations: readonly IPriceObservation[],
  secondsPerYear: bigint = SECONDS_PER_YEAR,
): IVolatilityResult {
  if (observations.length < 2) {
    throw new Error(
      `realizedVolatility requires at least 2 observations, got ${observations.length}`,
    );
  }

  if (secondsPerYear <= 0n) {
    throw new Error(`secondsPerYear must be positive, got ${secondsPerYear}`);
  }

  const baseDecimals = observations[0]!.decimals;

  for (const obs of observations) {
    if (obs.decimals !== baseDecimals) {
      throw new Error(
        `realizedVolatility expects uniform decimals, found ${obs.decimals} vs ${baseDecimals}`,
      );
    }

    if (obs.price <= 0n) {
      throw new Error(`realizedVolatility got non-positive price: ${obs.price}`);
    }
  }

  // Log returns (LN_SCALE precision) and total Δt.
  const logReturns: bigint[] = [];
  let totalDt = 0n;

  for (let i = 1; i < observations.length; i++) {
    const prev = observations[i - 1]!;
    const curr = observations[i]!;

    if (curr.timestamp < prev.timestamp) {
      throw new Error(
        `realizedVolatility expects non-decreasing timestamps; `
        + `got ${prev.timestamp} -> ${curr.timestamp}`,
      );
    }

    const dt = curr.timestamp - prev.timestamp;
    if (dt <= 0n) {
      throw new Error(`realizedVolatility got zero-Δt observation pair at i=${i}`);
    }

    totalDt += dt;

    // ln(curr/prev) = ln(curr) − ln(prev).
    const lnpCurr = bigintLn(curr.price, baseDecimals);
    const lnpPrev = bigintLn(prev.price, baseDecimals);
    logReturns.push(lnpCurr - lnpPrev);
  }

  const nReturns = logReturns.length;

  // Sample mean μ.
  let sum = 0n;
  for (const r of logReturns) {
    sum += r;
  }

  const meanScaled = sum / BigInt(nReturns);

  // Sample variance σ² = Σ(r − μ)² / (n − 1).
  //
  // Scale bookkeeping:
  //   `r` is at LN_SCALE precision (1e18 == 1.0).
  //   `dev = r − μ` is at LN_SCALE precision.
  //   `dev * dev` is at LN_SCALE² precision (1e36 == 1.0).
  //   We want `Σ(dev²)` at *LN_SCALE* precision (1e18 == 1.0), so
  //     divide each `dev * dev` by LN_SCALE.
  //   Variance is `Σ/(n-1)` at LN_SCALE precision.
  //   σ_period = sqrt(variance) is at sqrt(LN_SCALE) precision
  //     (1e9 == 1.0). To return it at LN_SCALE precision (1e18 ==
  //     1.0), multiply by `sqrt(LN_SCALE)`.
  let sumSq = 0n;
  for (const r of logReturns) {
    const dev = r - meanScaled;
    sumSq += (dev * dev) / LN_SCALE;
  }

  const variance = sumSq / BigInt(nReturns - 1); // at LN_SCALE precision.

  // σ_period = sqrt(variance). `bigintSqrtFloor` returns the integer
  // floor at the input's natural scale (1.0 == sqrt(LN_SCALE)).
  const sigmaPeriodSqrtScale = bigintSqrtFloor(variance);

  // Rescale: at 1e18 == 1.0, σ_period = sigmaPeriodSqrtScale * sqrt(LN_SCALE).
  const sqrtLnScale = bigintSqrtFloor(LN_SCALE);

  if (sqrtLnScale === 0n) {
    throw new Error('bigintSqrtFloor(LN_SCALE) collapsed to 0 (bug)');
  }

  const sigmaPeriodLnScale = sigmaPeriodSqrtScale * sqrtLnScale;

  // Annualize: σ_ann = σ_period * sqrt(secondsPerYear / meanDt).
  const meanDt = totalDt / BigInt(nReturns);

  if (meanDt <= 0n) {
    throw new Error('realizedVolatility meanΔt collapsed to 0');
  }

  // ratioScaled at LN_SCALE precision: ratio = (spy * LN_SCALE) / meanDt.
  const ratioScaled = (secondsPerYear * LN_SCALE) / meanDt;
  const sqrtRatioSqrtScale = bigintSqrtFloor(ratioScaled);
  const sqrtRatioLnScale = sqrtRatioSqrtScale * sqrtLnScale;

  // σ_ann at LN_SCALE = (σ_period at LN_SCALE) * (sqrtRatio at LN_SCALE) / LN_SCALE.
  const sigmaAnnLnScale = (sigmaPeriodLnScale * sqrtRatioLnScale) / LN_SCALE;

  // Rescale to VOLATILITY_SCALE (1e18 == 1.0).
  const sigmaAnn = sigmaAnnLnScale; // LN_SCALE == VOLATILITY_SCALE.
  const sigmaPeriodScaled = sigmaPeriodLnScale;

  return {
    volAnnual: sigmaAnn,
    volPerPeriod: sigmaPeriodScaled,
    meanDt,
    nReturns,
  };
}

/**
 * Convenience overload accepting `Price` value objects (e.g. from
 * `PoolSnapshot.price`). `Price.decimals` is used; `timestamp` is
 * passed alongside in a parallel array.
 */
export function realizedVolatilityFromPrices(
  prices: readonly Price[],
  timestamps: readonly bigint[],
  secondsPerYear: bigint = SECONDS_PER_YEAR,
): IVolatilityResult {
  if (prices.length !== timestamps.length) {
    throw new Error(
      `realizedVolatilityFromPrices: prices and timestamps length mismatch `
      + `(${prices.length} vs ${timestamps.length})`,
    );
  }

  const obs: IPriceObservation[] = prices.map((p, i) => ({
    price: p.value,
    decimals: p.decimals,
    timestamp: timestamps[i]!,
  }));

  return realizedVolatility(obs, secondsPerYear);
}