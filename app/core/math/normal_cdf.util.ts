// app/core/math/normal_cdf.util.ts

/**
 * Standard-normal CDF `Φ(x)` as a fixed-point bigint.
 *
 * Why: the recommendation engine turns a candidate range's
 * half-width into a z-score `k` and needs `P(in range) = 2Φ(k) − 1`
 * (TVL-ROADMAP.md §5.4). The Core never lets a float carry money,
 * so `Φ` is computed in bigint fixed point and returned at
 * `NORMAL_CDF_SCALE` (1e18 == 1.0).
 *
 * Method (no tables, no magic constants):
 *
 *     Φ(x) = ½ + (1/√π) · Σ_{n≥0} (−1)ⁿ z^(2n+1) / (n! (2n+1))
 *     z    = x / √2
 *
 * (the `1/√π` comes from `erf(z) = (2/√π)·Σ …` and
 * `Φ(x) = ½(1 + erf(x/√2))` — the `1/√(2π)` normalisation
 * belongs to the *density*, not to the CDF)
 *
 * The series converges for every `z`, but it suffers *cancellation*
 * for large `z` (its partial sums grow like `e^{z²}` while the
 * result stays ≈ 1), so it is used only up to `z ≤ 4.5`
 * (i.e. `|x| ≤ 6.4`). Beyond that the tail comes from the
 * asymptotic expansion of `erfc`:
 *
 *     erfc(z) ≈ e^{−z²} / (z√π) · Σ_{n≥0} (−1)ⁿ (2n−1)!! / (2z²)ⁿ
 *
 * truncated at its smallest term (the optimal truncation point),
 * which keeps `Φ` accurate to ~1e-20 for `z > 4.5`.
 *
 * `√2` and `√π` are *computed* at load time with an integer square
 * root (π truncated to 30 decimals) rather than hard-coded, so a
 * mistyped digit cannot silently poison every result.
 *
 * Accuracy: ~1e-19 absolute in `Φ` — far better than the 1e-15 the
 * roadmap's slice-4 test plan asks for.
 */

import { toScaledBigint } from '../shared/utils';
import { bigintSqrtFloor } from './il.util';

/** Scale of the `Φ` outputs (1e18 == 1.0). */
export const NORMAL_CDF_SCALE = 1_000_000_000_000_000_000n; // 1e18

/** Internal working scale (1e30) — 12 digits of headroom. */
const WORK_SCALE = 10n ** 30n;

/** π truncated to 30 decimals (`3.141592653589793238462643383279`). */
const PI_AT_WORK_SCALE = 3_141_592_653_589_793_238_462_643_383_279n;

/** √2 at `WORK_SCALE`. */
const SQRT2 = bigintSqrtFloor(2n * WORK_SCALE * WORK_SCALE);

/** √π at `WORK_SCALE`. */
const SQRT_PI = bigintSqrtFloor(PI_AT_WORK_SCALE * WORK_SCALE);

/** `1/√π` at `WORK_SCALE` (the erf/CDF normalisation). */
const INV_SQRT_PI = (WORK_SCALE ** 2n) / SQRT_PI;

/**
 * Above this `|x|` the CDF is 1 (or 0) to well beyond the 1e-18
 * output resolution: `Φ(12) = 1 − 1.8e-33`.
 */
const MAX_ABS_X = 12;

/** Series branch limit: `z = x/√2 ≤ 4.5`. */
const SERIES_Z_LIMIT = 4n * WORK_SCALE + WORK_SCALE / 2n;

/** Hard iteration cap for the erf series. */
const MAX_SERIES_TERMS = 500;

/** Hard iteration cap for the asymptotic expansion. */
const MAX_ASYMPTOTIC_TERMS = 200;

/**
 * A term below this magnitude (at `WORK_SCALE`) is far below the
 * output resolution — 100 units at 1e30 is 1e-28 absolute.
 */
const TERM_FLOOR = 100n;

/**
 * `Φ(x)` — the standard normal CDF — at `NORMAL_CDF_SCALE`.
 *
 * @param x - The argument (any finite number).
 * @returns `Φ(x)` at 1e18 precision (1e18 == 1.0).
 * @throws When `x` is not finite.
 */
export function normalCdf(x: number): bigint {
  if (!Number.isFinite(x)) {
    throw new Error(`normalCdf: x must be a finite number, got ${x}`);
  }

  if (x >= MAX_ABS_X) {
    return NORMAL_CDF_SCALE;
  }

  if (x <= -MAX_ABS_X) {
    return 0n;
  }

  if (x < 0) {
    // Symmetry: Φ(−x) = 1 − Φ(x).
    return NORMAL_CDF_SCALE - normalCdf(-x);
  }

  // z = x / √2, at WORK_SCALE.
  const zScaled = (toScaledBigint(x, 30) * WORK_SCALE) / SQRT2;

  const phiWork = zScaled <= SERIES_Z_LIMIT
    ? phiViaSeries(zScaled)
    : phiViaTail(zScaled);

  // WORK_SCALE → NORMAL_CDF_SCALE (divide by 1e12).
  return (phiWork * NORMAL_CDF_SCALE) / WORK_SCALE;
}

/**
 * `P(in range) = 2Φ(k) − 1` — the two-sided coverage of a `k`-σ
 * band (TVL-ROADMAP.md §5.4).
 *
 * `k = 1` → 68.3%, `k = 1.65` → 90.1%, `k = 2` → 95.4%,
 * `k = 2.5` → 98.8%.
 *
 * Negative `k` has no meaning for a half-width, so the result is
 * floored at `0n`.
 *
 * @param k - The z-score (σ-multiplier) of the band.
 * @returns Coverage at `NORMAL_CDF_SCALE` (1e18 == 1.0).
 */
export function twoSidedCoverage(k: number): bigint {
  if (!Number.isFinite(k)) {
    throw new Error(`twoSidedCoverage: k must be a finite number, got ${k}`);
  }

  if (k <= 0) {
    return 0n;
  }

  const coverage = 2n * normalCdf(k) - NORMAL_CDF_SCALE;

  return coverage > 0n ? coverage : 0n;
}

/**
 * `Φ(x)` via the erf power series (valid — and numerically sane —
 * for `z = x/√2 ≤ 4.5`).
 */
function phiViaSeries(zScaled: bigint): bigint {
  const z2Scaled = (zScaled * zScaled) / WORK_SCALE;

  // Σ (−1)ⁿ z^(2n+1) / (n! (2n+1)), term 0 = z.
  let term = zScaled;
  let sum = zScaled;

  for (let n = 1; n <= MAX_SERIES_TERMS; n++) {
    // term_n = −term_{n−1} · z² · (2n−1) / (n · (2n+1))
    const next = -((term * z2Scaled * BigInt(2 * n - 1))
      / (WORK_SCALE * BigInt(n) * BigInt(2 * n + 1)));
    sum += next;
    term = next;

    if (next > -TERM_FLOOR && next < TERM_FLOOR) {
      break;
    }
  }

  // Φ = ½ + (1/√π) · Σ
  return (WORK_SCALE / 2n) + ((INV_SQRT_PI * sum) / WORK_SCALE);
}

/**
 * `Φ(x)` via the Gaussian tail: `Φ(x) = 1 − ½·erfc(x/√2)` with
 * `erfc` from its asymptotic expansion (used for `z > 4.5`, where
 * the power series would cancel catastrophically).
 */
function phiViaTail(zScaled: bigint): bigint {
  const z2Scaled = (zScaled * zScaled) / WORK_SCALE;

  // A = Σ (−1)ⁿ (2n−1)!! / (2z²)ⁿ — truncated at its smallest term.
  let term = WORK_SCALE;
  let sum = WORK_SCALE;
  let prevAbs = term;

  for (let n = 1; n <= MAX_ASYMPTOTIC_TERMS; n++) {
    // term_n = −term_{n−1} · (2n−1) / (2z²)
    const next = -((term * BigInt(2 * n - 1) * WORK_SCALE) / (2n * z2Scaled));
    const nextAbs = next < 0n ? -next : next;

    // The expansion is asymptotic: once the terms start growing
    // again the optimal truncation point is behind us.
    if (nextAbs >= prevAbs) {
      break;
    }

    sum += next;
    term = next;
    prevAbs = nextAbs;
  }

  // erfc(z) = e^{−z²} · A / (z√π)
  //
  // Scale bookkeeping: `expNeg`, `sum`, `zScaled` and `SQRT_PI` are
  // all at `WORK_SCALE`, so the dimensionless ratio
  // `e^{−z²}·A/(z·√π)` is re-scaled by one `WORK_SCALE` here.
  const expNeg = expNegativeFixed(z2Scaled);
  const erfcWork = (expNeg * sum * WORK_SCALE) / (zScaled * SQRT_PI);

  // Φ = 1 − ½·erfc(z)
  return WORK_SCALE - erfcWork / 2n;
}

/**
 * `e^{−u}` at `WORK_SCALE`, for `u ≥ 0` given at `WORK_SCALE`.
 *
 * Range-reduces (`e^{−u} = (e^{−u/2ᵏ})^{2ᵏ}`) and then runs a
 * Taylor series on the reduced argument (`≤ 1`), which has no
 * cancellation problem. Each squaring doubles the relative error,
 * so the result carries ~30 − k digits.
 */
function expNegativeFixed(uScaled: bigint): bigint {
  if (uScaled === 0n) {
    return WORK_SCALE;
  }

  let reduced = uScaled;
  let k = 0;

  while (reduced > WORK_SCALE && k < 64) {
    reduced /= 2n;
    k += 1;
  }

  // Taylor: e^{−y} = Σ (−y)ⁿ / n!
  let term = WORK_SCALE;
  let sum = WORK_SCALE;

  for (let n = 1; n <= 60; n++) {
    term = -((term * reduced) / (WORK_SCALE * BigInt(n)));
    sum += term;

    if (term > -TERM_FLOOR && term < TERM_FLOOR) {
      break;
    }
  }

  let value = sum;

  for (let i = 0; i < k; i++) {
    value = (value * value) / WORK_SCALE;
  }

  return value;
}
