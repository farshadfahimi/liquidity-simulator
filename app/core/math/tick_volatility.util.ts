// app/core/math/tick_volatility.util.ts

/**
 * Volatility measured directly in **tick space**.
 *
 * Because `price = 1.0001^tick`, a move of `Δtick` ticks is a
 * log-return of `Δtick · ln(1.0001)`. Working in ticks therefore:
 *
 *   - removes token decimals and price direction (token1/token0 vs
 *     its inverse) from the calculation entirely,
 *   - makes the result directly usable as a range half-width,
 *   - cannot produce a negative price: `lower = tick − halfWidth`
 *     is a tick, and every tick maps to a strictly positive price.
 *
 * Units used here:
 *
 *   - `sigmaPerSecond` — standard deviation of the tick change per
 *     √second (ticks / √s). Scale to any horizon `H` with
 *     `σ_H = sigmaPerSecond · √H_seconds`.
 *   - "daily σ in ticks" — `sigmaPerSecond · √86400`, the unit
 *     `VolatilityAdjustedRangeGenerator.dailySigmaTicks` expects.
 *
 * These are statistics, not on-chain amounts, so they are plain
 * `number`s (ticks themselves are `number` throughout the Core).
 */

/** `ln(1.0001)` — natural-log size of one tick. */
export const LN_TICK = Math.log(1.0001);

const SECONDS_PER_DAY = 86_400;

/** Default seconds-per-year, same convention as `SECONDS_PER_YEAR` in volatility.util. */
const DEFAULT_SECONDS_PER_YEAR = 31_557_600;

/** One `(timestamp, tick)` observation; structurally matches `IHistorySnapshotDTO`. */
export interface ITickSample {
  /** Unix seconds. */
  readonly timestamp: bigint;
  readonly tick: number;
}

/**
 * Variance of the tick change per second, in tick² / s:
 * `Σ (Δtick)² / Σ Δt` (zero-mean estimator, appropriate for the
 * short intervals used here — it also handles unevenly spaced
 * samples). Zero-Δt pairs are skipped.
 *
 * @param samples - Chronological observations (≥ 2 with distinct timestamps).
 */
export function tickVariancePerSecond(samples: readonly ITickSample[]): number {
  let sumSq = 0;
  let sumDt = 0;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const curr = samples[i]!;
    const dt = Number(curr.timestamp - prev.timestamp);

    if (dt < 0) {
      throw new Error(
        `tickVariancePerSecond expects non-decreasing timestamps; got ${prev.timestamp} -> ${curr.timestamp}`,
      );
    }

    if (dt === 0) {
      continue;
    }

    const d = curr.tick - prev.tick;
    sumSq += d * d;
    sumDt += dt;
  }

  if (sumDt === 0) {
    throw new Error('tickVariancePerSecond requires ≥ 2 samples with distinct timestamps');
  }

  return sumSq / sumDt;
}

/**
 * Blend the tick volatility measured over several trailing windows
 * (default 14 / 30 / 60 days, weights 0.5 / 0.3 / 0.2) into one
 * `sigmaPerSecond`. Variances are blended (not standard deviations)
 * and re-normalised over the windows that actually have ≥ 3 samples,
 * so a short history degrades gracefully to the windows it covers.
 *
 * @param samples - Chronological observations.
 * @param windowsDays - Trailing windows in days, measured back from the last sample.
 * @param weights - One non-negative weight per window.
 * @returns σ in ticks per √second.
 */
export function blendedSigmaTicksPerSecond(
  samples: readonly ITickSample[],
  windowsDays: readonly number[] = [14, 30, 60],
  weights: readonly number[] = [0.5, 0.3, 0.2],
): number {
  if (samples.length < 3) {
    throw new Error(`blendedSigmaTicksPerSecond requires ≥ 3 samples, got ${samples.length}`);
  }

  if (windowsDays.length === 0 || windowsDays.length !== weights.length) {
    throw new Error('blendedSigmaTicksPerSecond: windowsDays and weights must be non-empty and equal length');
  }

  const end = samples[samples.length - 1]!.timestamp;
  let variance = 0;
  let weightSum = 0;

  for (let i = 0; i < windowsDays.length; i++) {
    const days = windowsDays[i]!;
    const weight = weights[i]!;

    if (!Number.isFinite(days) || days <= 0 || !Number.isFinite(weight) || weight < 0) {
      throw new Error(`blendedSigmaTicksPerSecond: invalid window ${days}d / weight ${weight}`);
    }

    const from = end - BigInt(Math.round(days * SECONDS_PER_DAY));
    const window = samples.filter((s) => s.timestamp >= from);

    if (window.length < 3 || weight === 0) {
      continue;
    }

    variance += weight * tickVariancePerSecond(window);
    weightSum += weight;
  }

  if (weightSum === 0) {
    throw new Error('blendedSigmaTicksPerSecond: no window had enough samples');
  }

  return Math.sqrt(variance / weightSum);
}

/**
 * Convert a `sigmaPerSecond` (ticks / √s) into the "daily σ in
 * ticks" unit used by `VolatilityAdjustedRangeGenerator`.
 */
export function dailySigmaTicksFromSigmaPerSecond(sigmaPerSecond: number): number {
  if (!Number.isFinite(sigmaPerSecond) || sigmaPerSecond < 0) {
    throw new Error(`sigmaPerSecond must be a non-negative finite number, got ${sigmaPerSecond}`);
  }

  return sigmaPerSecond * Math.sqrt(SECONDS_PER_DAY);
}

/**
 * Convert an **annualized** log-return volatility (as returned by
 * `realizedVolatility`, at `VOLATILITY_SCALE` = 1e18 == 100%) into
 * "daily σ in ticks". This is the explicit bridge between the two σ
 * conventions in the codebase: feeding an annualized number straight
 * into a field that expects daily ticks inflates the range by
 * `√365 ≈ 19×` (and by `1/ln(1.0001) ≈ 10000×` in units).
 *
 * @param volAnnual - Annualized volatility at 1e18 == 100%.
 * @param secondsPerYear - Annualization convention (default 31_557_600).
 */
export function dailySigmaTicksFromAnnualVol(
  volAnnual: bigint,
  secondsPerYear: number = DEFAULT_SECONDS_PER_YEAR,
): number {
  if (volAnnual < 0n) {
    throw new Error(`volAnnual must be non-negative, got ${volAnnual}`);
  }

  if (!Number.isFinite(secondsPerYear) || secondsPerYear <= 0) {
    throw new Error(`secondsPerYear must be positive, got ${secondsPerYear}`);
  }

  const annual = Number(volAnnual) / 1e18;
  const dailyLog = annual * Math.sqrt(SECONDS_PER_DAY / secondsPerYear);

  return dailyLog / LN_TICK;
}
