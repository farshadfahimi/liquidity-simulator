// app/core/math/apr.util.ts

/**
 * APR estimation math.
 *
 * The "obvious" way to compute an LP APR is from the pool's
 * `feeGrowthGlobal` deltas — but that requires feeGrowth-inside-LP
 * accounting using the loaded ticks, which is non-trivial and
 * generally needs a full simulation. For Phase 4 we ship a simpler
 * estimator that consumes *already-collected* fee amounts plus a
 * window length:
 *
 *     APR_token = (fees / principal) * (secondsPerYear / windowSec)
 *
 * with the convention that `fees` and `principal` are denominated in
 * the *same* token's smallest units (raw bigint). Output is at
 * `APR_SCALE` (1e18 == 100% APR).
 *
 * For a CL position that earns fees in *both* legs, the caller can
 * convert each leg's fees to a common denominator (typically the
 * numeraire — e.g. USDC) and sum, then divide by the principal
 * expressed in the same numeraire. We expose `aprFromFees(...)` plus
 * a `combinedApr(...)` helper that handles the two-leg case when
 * token prices are supplied.
 */

import { SECONDS_PER_YEAR } from './volatility.util';

/** Bigint scale used for APR outputs (1e18 == 100% APR). */
export const APR_SCALE = 1_000_000_000_000_000_000n; // 1e18

/**
 * Compute `APR` from a single-leg fees/principal pair observed over
 * `windowSeconds`.
 *
 * @param feesRaw - Fees collected in the period (raw bigint).
 * @param principalRaw - Capital deployed at the start of the period
 *   (raw bigint, in the same token's smallest units).
 * @param windowSeconds - Length of the observation window (seconds).
 * @param secondsPerYear - Override seconds-per-year (default
 *   `SECONDS_PER_YEAR`).
 * @returns APR scaled by `APR_SCALE` (1e18 == 100%).
 */
export function aprFromFees(
  feesRaw: bigint,
  principalRaw: bigint,
  windowSeconds: bigint,
  secondsPerYear: bigint = SECONDS_PER_YEAR,
): bigint {
  if (principalRaw <= 0n) {
    throw new Error(`aprFromFees: principalRaw must be positive, got ${principalRaw}`);
  }

  if (windowSeconds <= 0n) {
    throw new Error(`aprFromFees: windowSeconds must be positive, got ${windowSeconds}`);
  }

  if (secondsPerYear <= 0n) {
    throw new Error(`aprFromFees: secondsPerYear must be positive, got ${secondsPerYear}`);
  }

  // rate_over_period = fees / principal, at 1e18 precision.
  const rateOverPeriod = (feesRaw * APR_SCALE) / principalRaw;

  // annualized = rateOverPeriod * (secondsPerYear / windowSeconds).
  // Multiply rateOverPeriod by secondsPerYear, then divide by windowSeconds.
  // Both are bigints, so do the high-precision multiply first.
  const annualized = (rateOverPeriod * secondsPerYear) / windowSeconds;
  return annualized;
}

/**
 * Compute the combined APR when fees are collected in *both* legs of
 * a position, denominated in a common numeraire.
 *
 * @param fees0InNumeraireRaw - token0 fees converted to numeraire
 *   (raw bigint, numeraire smallest units).
 * @param fees1InNumeraireRaw - token1 fees converted to numeraire
 *   (raw bigint, numeraire smallest units).
 * @param principalInNumeraireRaw - Total principal converted to
 *   numeraire (raw bigint, numeraire smallest units).
 * @param windowSeconds - Length of the observation window.
 * @param secondsPerYear - Override seconds-per-year.
 */
export function combinedApr(
  fees0InNumeraireRaw: bigint,
  fees1InNumeraireRaw: bigint,
  principalInNumeraireRaw: bigint,
  windowSeconds: bigint,
  secondsPerYear: bigint = SECONDS_PER_YEAR,
): bigint {
  if (principalInNumeraireRaw <= 0n) {
    throw new Error(
      `combinedApr: principalInNumeraireRaw must be positive, got ${principalInNumeraireRaw}`,
    );
  }

  if (windowSeconds <= 0n) {
    throw new Error(`combinedApr: windowSeconds must be positive, got ${windowSeconds}`);
  }

  if (secondsPerYear <= 0n) {
    throw new Error(`combinedApr: secondsPerYear must be positive, got ${secondsPerYear}`);
  }

  const totalFees = fees0InNumeraireRaw + fees1InNumeraireRaw;
  if (totalFees < 0n) {
    throw new Error(
      `combinedApr: total fees went negative (got ${totalFees}); `
      + 'check the fee conversion math',
    );
  }

  return aprFromFees(totalFees, principalInNumeraireRaw, windowSeconds, secondsPerYear);
}

/**
 * Compute `APR` from a "fees in token0 and token1, principal in
 * token0 and token1" tuple, given a single numeraire price per token.
 * Useful when the caller already has fee amounts in raw token units.
 *
 * **All conversions land in the numeraire at `numeraireDecimals`
 * precision**, so leg totals can be summed without scale mismatch.
 *
 * @param fees0Raw - Fees collected in token0 (raw, `token0.decimals`).
 * @param fees1Raw - Fees collected in token1 (raw, `token1.decimals`).
 * @param principal0Raw - Principal in token0 (raw, `token0.decimals`).
 * @param principal1Raw - Principal in token1 (raw, `token1.decimals`).
 * @param token0PriceScaled - `token0 price in numeraire` at
 *   `priceDecimals` of precision (e.g. 405e18 for ~$405 ETH).
 * @param token1PriceScaled - Same for token1.
 * @param priceDecimals - Decimals of `token0PriceScaled` and
 *   `token1PriceScaled` (default 18).
 * @param token0Decimals - Decimals of `fees0Raw` / `principal0Raw`.
 * @param token1Decimals - Decimals of `fees1Raw` / `principal1Raw`.
 * @param numeraireDecimals - Decimals of the numeraire (e.g. 6 for
 *   USDC). All output sums are at this scale.
 * @param windowSeconds - Window length.
 * @param secondsPerYear - Override seconds-per-year.
 */
export function aprFromRawTwoLeg(
  fees0Raw: bigint,
  fees1Raw: bigint,
  principal0Raw: bigint,
  principal1Raw: bigint,
  token0PriceScaled: bigint,
  token1PriceScaled: bigint,
  priceDecimals: number,
  token0Decimals: number,
  token1Decimals: number,
  numeraireDecimals: number,
  windowSeconds: bigint,
  secondsPerYear: bigint = SECONDS_PER_YEAR,
): bigint {
  if (!Number.isInteger(priceDecimals) || priceDecimals < 0) {
    throw new Error(`aprFromRawTwoLeg priceDecimals must be a non-negative integer, got ${priceDecimals}`);
  }

  if (!Number.isInteger(token0Decimals) || token0Decimals < 0) {
    throw new Error(`aprFromRawTwoLeg token0Decimals must be a non-negative integer, got ${token0Decimals}`);
  }

  if (!Number.isInteger(token1Decimals) || token1Decimals < 0) {
    throw new Error(`aprFromRawTwoLeg token1Decimals must be a non-negative integer, got ${token1Decimals}`);
  }

  if (!Number.isInteger(numeraireDecimals) || numeraireDecimals < 0) {
    throw new Error(`aprFromRawTwoLeg numeraireDecimals must be a non-negative integer, got ${numeraireDecimals}`);
  }

  // Convert each (raw amount, price, scale) triple into the numeraire
  // at `numeraireDecimals`:
  //   value_num = raw * price / 10^rawDec / 10^priceDec * 10^numeraireDec
  //            = raw * price * 10^(numDec - rawDec - priceDec)
  const priceScale = 10n ** BigInt(priceDecimals);

  const token0Delta = BigInt(numeraireDecimals - token0Decimals);
  const token1Delta = BigInt(numeraireDecimals - token1Decimals);

  const fees0Num = token0Delta >= 0n
    ? (fees0Raw * token0PriceScaled * 10n ** token0Delta) / priceScale
    : (fees0Raw * token0PriceScaled) / priceScale / 10n ** (-token0Delta);
  const fees1Num = token1Delta >= 0n
    ? (fees1Raw * token1PriceScaled * 10n ** token1Delta) / priceScale
    : (fees1Raw * token1PriceScaled) / priceScale / 10n ** (-token1Delta);
  const principal0Num = token0Delta >= 0n
    ? (principal0Raw * token0PriceScaled * 10n ** token0Delta) / priceScale
    : (principal0Raw * token0PriceScaled) / priceScale / 10n ** (-token0Delta);
  const principal1Num = token1Delta >= 0n
    ? (principal1Raw * token1PriceScaled * 10n ** token1Delta) / priceScale
    : (principal1Raw * token1PriceScaled) / priceScale / 10n ** (-token1Delta);

  const totalFeesNum = fees0Num + fees1Num;
  const totalPrincipalNum = principal0Num + principal1Num;

  // Result is at `numeraireDecimals` precision in numeraire units —
  // consistent with `aprFromFees` which expects raw numeraire
  // smallest units (which is exactly what numeraireDecimals gives us).
  return aprFromFees(totalFeesNum, totalPrincipalNum, windowSeconds, secondsPerYear);
}