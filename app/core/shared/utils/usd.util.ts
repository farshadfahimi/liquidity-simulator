// app/core/shared/utils/usd.util.ts

/**
 * USD money helpers.
 *
 * Unit convention (TVL-ROADMAP §5.1): every USD amount that crosses
 * a Core boundary is a `bigint` at `USD_DECIMALS` (6) of precision —
 * i.e. `1_000_000n` == `$1.00`.
 *
 * Why 6 and not 18?
 *   - The only source of USD amounts with a fractional part today is
 *     an HTTP JSON payload (DefiLlama), which is parsed as a JS
 *     `number`. Six decimals is the smallest scale where the
 *     conversion reproduces the payload value exactly for every
 *     magnitude DefiLlama reports (verified upstream:
 *     `88992532.21365` → `88992532213650n`).
 *   - 6 also matches USDC's own on-chain decimals, so a stablecoin
 *     numeraire needs no rescaling when the two meet.
 *
 * Token USD **prices** stay at 1e18 (they multiply raw token
 * amounts); only *amounts of money* live at 6 decimals.
 */

import { toScaledBigint } from './scale.util';

/** Bigint scale used for every USD **amount** in the Core (1e6 == $1.00). */
export const USD_DECIMALS = 6;

/**
 * Bigint scale used for token USD **prices** (1e18 == $1.00).
 *
 * Prices live one scale above amounts: they *multiply* raw token
 * amounts, so they must not lose precision. An amount keeps 6
 * decimals because that is what the source JSON can express; a price
 * keeps 18 because it is a ratio of two amounts.
 */
export const USD_PRICE_DECIMALS = 18;

/**
 * Convert a USD `number` into a USD bigint at `USD_DECIMALS`.
 *
 * @param value - USD amount as a float (e.g. `1234.56`).
 * @returns The amount at `USD_DECIMALS` (e.g. `1234560000n`).
 */
export function toUsdBigint(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Error(`toUsdBigint: value must be a finite number, got ${value}`);
  }

  return toScaledBigint(value, USD_DECIMALS);
}

/**
 * Convert a USD `number` into a USD **price** bigint at
 * `USD_PRICE_DECIMALS` (1e18).
 *
 * @param value - USD price as a float (e.g. `1797.0162017200657`).
 * @returns The price at 1e18 (e.g. `1797016201720065701n`).
 */
export function toUsdPriceBigint(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Error(
      `toUsdPriceBigint: value must be a finite number, got ${value}`,
    );
  }

  return toScaledBigint(value, USD_PRICE_DECIMALS);
}

/**
 * Format a USD bigint as a human-readable string with thousands
 * separators, e.g. `1234567890n` → `"1,234.57"`.
 *
 * Rounding is half-up at `fractionDigits` (which may not exceed
 * `USD_DECIMALS` — the amount carries no more precision than that).
 *
 * @param value - USD amount at `USD_DECIMALS`.
 * @param fractionDigits - Digits kept after the decimal point.
 */
export function formatUsd(value: bigint, fractionDigits: number = 2): string {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
    throw new Error(
      `formatUsd fractionDigits must be a non-negative integer, got ${fractionDigits}`,
    );
  }

  if (fractionDigits > USD_DECIMALS) {
    throw new Error(
      `formatUsd fractionDigits must be <= ${USD_DECIMALS}, got ${fractionDigits}`,
    );
  }

  const negative = value < 0n;
  const abs = negative ? -value : value;

  const divisor = 10n ** BigInt(USD_DECIMALS);
  const unit = 10n ** BigInt(fractionDigits);

  // Round the whole amount (not just the fraction) so a carry
  // (e.g. 0.999 → 1.00) is handled correctly.
  const scaled = (abs * unit + divisor / 2n) / divisor;

  const whole = scaled / unit;
  const fraction = scaled % unit;

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const tail = fractionDigits === 0
    ? ''
    : `.${fraction.toString().padStart(fractionDigits, '0')}`;

  return negative ? `-${grouped}${tail}` : `${grouped}${tail}`;
}
