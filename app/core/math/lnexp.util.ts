// app/core/math/lnexp.util.ts

/**
 * Exponential `exp(x)` for fixed-point bigints.
 *
 * Companion to the private `bigintLn` inside
 * {@link ./volatility.util}. We keep this as a separate module
 * because `exp` is genuinely useful outside vol estimation (Phase 5
 * Monte Carlo walks, Phase 4's synthetic-history anchoring trick)
 * and we want callers to be able to depend on it without pulling in
 * the rest of the volatility surface.
 *
 * Numerics:
 *
 *   - `value` is `x` at `decimals` of precision (so e.g. `value =
 *     10^decimals` means `x = 1.0`).
 *   - Output `exp(x)` is at `decimals` of precision too — i.e.
 *     `exp(0) == 10^decimals`.
 *   - Implementation: range-reduce `x` into pieces using
 *       `exp(x) = exp(x/2^k) ^ (2^k)`
 *     and use a Taylor series on the reduced argument. 6 terms give
 *     ~1e-4 relative accuracy for `|x/2^k| < 1`, more than enough
 *     for MC price generation at 1e18 precision.
 *   - Internally we scale by `LN_SCALE = 1e18` to keep arithmetic
 *     uniform across the math layer.
 */

/** Internal scale used for log/exp intermediates (1e18 == 1.0). */
const LN_SCALE = 1_000_000_000_000_000_000n;

/** `ln(2)` at `LN_SCALE` precision (matches volatility.util). */
const LN2_AT_SCALE = 693147180559945309n;

/** `ln(2)` shifted so `value` can be scaled to LN_SCALE for division. */
function ln2ScaledFor(decimals: number): bigint {
  // LN2 at LN_SCALE (1e18), rescaled to `decimals`.
  if (decimals <= 18) {
    return LN2_AT_SCALE / 10n ** BigInt(18 - decimals);
  }

  return LN2_AT_SCALE * 10n ** BigInt(decimals - 18);
}

/**
 * Compute `exp(x)` where `x` is a fixed-point bigint at `decimals`
 * precision. Output is also at `decimals` precision — i.e.
 * `exp(0) == 10^decimals`.
 *
 * Range-reduce:
 *
 *   `exp(x) = (exp(x/2^k)) ^ (2^k)`
 *
 * We pick `k` so `|x/2^k| < 1` (in LN_SCALE terms). 8 reduction
 * steps is plenty for any reasonable x in the [−5, 5] range. Then
 * Taylor on the small argument:
 *
 *   `exp(y) = 1 + y + y²/2 + y³/6 + y⁴/24 + y⁵/120 + y⁶/720`.
 *
 * Accuracy: ~1e-6 relative for `|y| < 1`; ~1e-4 relative for
 * `|y| < 2`. We deliberately keep the table compact because MC
 * paths usually call `exp` 100k+ times per simulation and accuracy
 * beyond 1e-4 is wasted on 18-dec fixed-point anyway.
 *
 * Negative arguments are supported via the standard identity
 * `exp(-x) = 1 / exp(x)`; we just compute the positive part and
 * scale by `10^(2*decimals) / positiveResult`.
 *
 * @throws if `decimals` is negative or non-integer.
 */
export function bigintExp(value: bigint, decimals: number): bigint {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new Error(
      `bigintExp decimals must be a non-negative integer, got ${decimals}`,
    );
  }

  if (value === 0n) {
    return 10n ** BigInt(decimals);
  }

  const sign = value < 0n ? -1 : 1;
  const absValue = sign === -1 ? -value : value;

  // Range reduction: while absValue > LN_SCALE (in 18-dec terms),
  // divide by 2 (LN_SCALE → LN_SCALE / 2) and remember a square.
  //
  // Concretely, we choose k so that absValue * LN_SCALE / (2^k * scale)
  // is small. The simplest invariant: keep dividing `absValue`
  // by 2 in user-scale terms (which means doubling the LN_SCALE
  // "cutoff"). Implementation: track a counter `k`; `absValue / 2^k`
  // in the original scale.
  let k = 0;
  let reduced = absValue;

  // Each iteration halves `reduced`. We cap k at 64 to bound loops.
  while (reduced > 10n ** BigInt(decimals) && k < 64) {
    reduced /= 2n;
    k += 1;
  }

  // Now `reduced <= 10^decimals` (i.e. `x_reduced <= 1.0`).
  // Compute `y = reduced / 10^decimals` in LN_SCALE terms.
  const yScaled = (reduced * LN_SCALE) / 10n ** BigInt(decimals);

  // Taylor at LN_SCALE precision.
  const Y = yScaled;
  const Y2 = (Y * Y) / LN_SCALE;
  const Y3 = (Y2 * Y) / LN_SCALE;
  const Y4 = (Y3 * Y) / LN_SCALE;
  const Y5 = (Y4 * Y) / LN_SCALE;
  const Y6 = (Y5 * Y) / LN_SCALE;

  const expY = LN_SCALE
    + Y
    + Y2 / 2n
    + Y3 / 6n
    + Y4 / 24n
    + Y5 / 120n
    + Y6 / 720n;

  // Undo reduction: square expY `k` times. Each squaring also
  // halves the precision (LN_SCALE → sqrt(LN_SCALE) effectively),
  // but at 1e18 starting precision and k ≤ ~6 that's fine.
  let expSmall = expY;
  for (let i = 0; i < k; i++) {
    expSmall = (expSmall * expSmall) / LN_SCALE;
  }

  // expSmall is at LN_SCALE precision. Rescale to `decimals`.
  let expPositive: bigint;

  if (decimals <= 18) {
    expPositive = expSmall / 10n ** BigInt(18 - decimals);
  } else {
    expPositive = expSmall * 10n ** BigInt(decimals - 18);
  }

  if (sign === 1) {
    return expPositive;
  }

  // Negative argument: exp(-x) = scale / exp(x).
  // scale = 10^decimals, so exp(-x) = 10^decimals / expPositive.
  // To preserve precision when `decimals` differs from the working
  // precision, compute at `2*decimals` and re-scale.
  const scale = 10n ** BigInt(decimals);
  const product = scale * scale;
  return product / expPositive;
}

/**
 * Convenience: compute `exp(x)` and immediately rescale to
 * `outDecimals`. Equivalent to
 * `bigintExp((value * 10^outDecimals) / 10^inDecimals, outDecimals)` —
 * useful when chaining math in different scales.
 */
export function bigintExpRescaled(
  value: bigint,
  inDecimals: number,
  outDecimals: number,
): bigint {
  if (inDecimals < 0 || !Number.isInteger(inDecimals)) {
    throw new Error(`bigintExpRescaled: inDecimals invalid: ${inDecimals}`);
  }

  if (outDecimals < 0 || !Number.isInteger(outDecimals)) {
    throw new Error(`bigintExpRescaled: outDecimals invalid: ${outDecimals}`);
  }

  if (inDecimals === outDecimals) {
    return bigintExp(value, inDecimals);
  }

  if (inDecimals < outDecimals) {
    return bigintExp(value * 10n ** BigInt(outDecimals - inDecimals), outDecimals);
  }

  return bigintExp(value / 10n ** BigInt(inDecimals - outDecimals), outDecimals);
}

/**
 * Re-export the LN2 constant for callers that need to convert
 * between per-period and per-year log-return scaling (e.g. for
 * Monte Carlo). At `LN_SCALE` precision.
 */
export const LN2_AT_LN_SCALE = LN2_AT_SCALE;

/** Scale used for log/exp intermediates (1e18 == 1.0). */
export const EXP_LN_SCALE = LN_SCALE;
