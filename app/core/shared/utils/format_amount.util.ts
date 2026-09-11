// app/core/shared/utils/format_amount.util.ts

/**
 * Format a raw on-chain amount (`bigint`, scaled by `decimals`) as a
 * decimal string at full precision (no rounding).
 *
 * Examples:
 *   formatAmount(1000000n, 6) -> "1"
 *   formatAmount(1500000n, 6) -> "1.5"
 *   formatAmount(123456789n, 6) -> "123.456789"
 */
export function formatAmount(value: bigint, decimals: number): string {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new Error(
      `formatAmount decimals must be a non-negative integer, got ${decimals}`,
    );
  }

  if (decimals === 0) {
    return value.toString();
  }

  const isNegative = value < 0n;
  const abs = isNegative ? -value : value;
  const padded = abs.toString().padStart(decimals, '0');
  const head = padded.slice(0, padded.length - decimals) || '0';
  const tail = padded.slice(padded.length - decimals);

  return isNegative ? `-${head}.${tail}` : `${head}.${tail}`;
}

/**
 * Truncate (floor) `value` at `decimals` of precision and return the
 * result as a string suitable for compact display. Trailing zeros are
 * stripped from the fractional part.
 *
 * Examples:
 *   formatAmountShort(123456789n, 6, 2) -> "123.45"
 *   formatAmountShort(1500000n, 6, 4) -> "1.5"
 */
export function formatAmountShort(
  value: bigint,
  decimals: number,
  fractionDigits: number,
): string {
  const full = formatAmount(value, decimals);

  if (fractionDigits < 0 || !Number.isInteger(fractionDigits)) {
    throw new Error(
      `formatAmountShort fractionDigits must be a non-negative integer, got ${fractionDigits}`,
    );
  }

  const dotIndex = full.indexOf('.');
  if (dotIndex === -1) {
    return full;
  }

  const integerPart = full.slice(0, dotIndex);
  const truncatedFraction = full
    .slice(dotIndex + 1, dotIndex + 1 + fractionDigits)
    .replace(/0+$/, '');

  return truncatedFraction.length > 0
    ? `${integerPart}.${truncatedFraction}`
    : integerPart;
}
