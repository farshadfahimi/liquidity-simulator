// app/core/shared/utils/scale.util.ts

/**
 * Exact float → scaled-bigint conversion.
 *
 * Why this exists: a JSON payload gives us a JS `number` (a double),
 * and the Core refuses to let a float carry money. The naive
 * conversion `BigInt(Math.round(value * 10 ** decimals))` silently
 * loses the low digits as soon as the product exceeds 2^53 — which
 * for an 18-decimal scale means **any price above ~$9**, and for a
 * 6-decimal scale any amount above ~$9 billion.
 *
 * `toFixed(decimals)` gives the *exact* decimal expansion of the
 * double (rounded at `decimals` fraction digits), which we then read
 * digit by digit into a bigint — no precision loss at all.
 *
 * Pure math — no I/O.
 */

/**
 * Convert a `number` into a bigint scaled by `10 ** decimals`.
 *
 * The conversion is exact: the result is the decimal expansion of the
 * input double, rounded half-up at `decimals` fraction digits.
 *
 * @param value - The value to convert (must be finite).
 * @param decimals - Number of fraction digits to keep (0–100).
 * @returns The scaled bigint (negative inputs keep their sign).
 */
export function toScaledBigint(value: number, decimals: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Error(
      `toScaledBigint: value must be a finite number, got ${value}`,
    );
  }

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 100) {
    throw new Error(
      `toScaledBigint: decimals must be an integer in [0, 100], got ${decimals}`,
    );
  }

  if (value === 0) {
    return 0n;
  }

  const abs = Math.abs(value);

  // `toFixed` switches to exponential notation at 1e21 (and throws
  // above it) — fall back to the scaled multiplication there. The
  // precision loss is irrelevant at those magnitudes.
  if (abs >= 1e21) {
    return BigInt(Math.round(value * 10 ** decimals));
  }

  const text = abs.toFixed(decimals);
  const dot = text.indexOf('.');
  const whole = dot === -1 ? text : text.slice(0, dot);
  const fraction = dot === -1
    ? ''
    : text.slice(dot + 1).padEnd(decimals, '0');

  const scale = 10n ** BigInt(decimals);
  const scaled = BigInt(whole) * scale + BigInt(fraction === '' ? '0' : fraction);

  return value < 0 ? -scaled : scaled;
}
