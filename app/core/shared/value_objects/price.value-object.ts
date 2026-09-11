// app/core/shared/value_objects/price.value-object.ts

/**
 * Immutable price value object, expressed as a fixed-point `bigint` at
 * `decimals` of precision. For example, a price of 2500.123456 USDC per
 * ETH at 18 decimals would be `value = 2500123456000000000000n`,
 * `decimals = 18`.
 *
 * Why an int-scaled price?
 *   - `number` loses precision above 2^53, but CL pool prices routinely
 *     need far more than that.
 *   - Using bigint with a fixed decimals scale lets math composes
 *     cleanly (multiplication = scale adds, division = scale sub).
 */
export class Price {
  readonly value: bigint;

  readonly decimals: number;

  constructor(value: bigint, decimals: number) {
    if (decimals < 0 || !Number.isInteger(decimals)) {
      throw new Error(
        `Price decimals must be a non-negative integer, got ${decimals}`,
      );
    }

    this.value = value;
    this.decimals = decimals;
  }

  /** Compute `this / other` at `decimals` of precision. */
  ratio(other: Price, decimals: number): Price {
    const scaleDelta = this.decimals - other.decimals + decimals;

    if (scaleDelta >= 0) {
      return new Price(this.value * 10n ** BigInt(scaleDelta) / other.value, decimals);
    }

    return new Price(this.value / other.value / 10n ** BigInt(-scaleDelta), decimals);
  }

  /** Format the price as a decimal string at full precision. */
  toString(): string {
    return formatBigIntAsDecimal(this.value, this.decimals);
  }
}

/**
 * Format `value` (scaled bigint) at `decimals` of precision as a decimal
 * string with no rounding. Negative scales are not allowed.
 */
function formatBigIntAsDecimal(value: bigint, decimals: number): string {
  if (decimals === 0) {
    return value.toString();
  }

  const isNegative = value < 0n;
  const abs = isNegative ? -value : value;
  const padded = abs.toString().padStart(decimals, '0');
  const head = padded.slice(0, padded.length - decimals) || '0';
  const tail = padded.slice(padded.length - decimals);
  const formatted = tail.length > 0 ? `${head}.${tail}` : head;

  return isNegative ? `-${formatted}` : formatted;
}
