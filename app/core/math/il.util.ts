// app/core/math/il.util.ts

/**
 * Impermanent loss (IL) math.
 *
 * IL is the relative loss a passive LP suffers versus a HODL
 * benchmark when price drifts. The classic V2 formula is
 *
 *     IL(p) = 2*sqrt(p) / (1 + p) - 1
 *
 * where `p = newPrice / oldPrice` (>0). We also expose
 * `ilBetweenPrices(...)` for the case where the caller has two
 * arbitrary `Price` objects (which may have different decimals).
 *
 * All return values are scaled by 1e18 (i.e. 1e18 == 100% = "0% IL"
 * is encoded as 0n; -1e18 == -100% IL is encoded as -1e18n).
 *
 * NOTE: This is the V2 / x*y=k IL formula applied to the *price
 * ratio*, not the V3 specific "concentrated" IL — concentrated
 * liquidity can have *worse* IL than V2 if the price exits the
 * range, or *zero* IL if the range fully brackets the move. The
 * caller is expected to combine this scalar IL with an in-range
 * indicator from the domain layer to express the full picture.
 */

/** Bigint scale used for all IL outputs (1e18 == 100%). */
export const IL_SCALE = 1_000_000_000_000_000_000n; // 1e18

/**
 * Square root of a non-negative bigint, floor. Uses Newton's method
 * with a starting point from `Number(value)`. Caller must ensure
 * `value >= 0`. We only need this for IL math, so accuracy to a few
 * wei is sufficient; we converge to true floor.
 */
export function bigintSqrtFloor(value: bigint): bigint {
  if (value < 0n) {
    throw new Error(`bigintSqrtFloor requires a non-negative input, got ${value}`);
  }

  if (value === 0n) {
    return 0n;
  }

  // Initial guess from a double-precision sqrt; good enough seed.
  const asNumber = Number(value);
  let x = BigInt(Math.max(1, Math.floor(Math.sqrt(asNumber))));

  // Newton's iteration; converges quickly.
  // Invariant: x*x <= value < (x+1)*(x+1).
  while (true) {
    const x1 = (x + value / x) / 2n;
    if (x1 >= x) {
      return x;
    }

    x = x1;
  }
}

/**
 * Compute impermanent loss given a price ratio `newPrice / oldPrice`.
 *
 * @param priceRatio - `newPrice / oldPrice`, scaled by `decimals`
 *   (typically 18). Must be > 0.
 * @param decimals - Scale of `priceRatio` (default 18).
 * @returns IL scaled by `IL_SCALE` (1e18 == 100%). Negative values
 *   indicate a loss vs HODL, 0 indicates no loss.
 */
export function ilFromPriceRatio(
  priceRatio: bigint,
  decimals: number = 18,
): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`ilFromPriceRatio decimals must be a non-negative integer, got ${decimals}`);
  }

  if (priceRatio <= 0n) {
    throw new Error(`ilFromPriceRatio priceRatio must be positive, got ${priceRatio}`);
  }

  const scale = 10n ** BigInt(decimals);
  const one = scale; // 1.0 at `decimals`
  const two = scale * 2n;

  // sqrt(p) at `decimals` precision: bigintSqrtFloor gives floor of
  // sqrt(p) at the integer scale, then divide by 10^decimals to put
  // it back into the decimals scale. To avoid precision loss we
  // scale up by 10^decimals before taking sqrt, then divide by
  // 10^decimals. That gives sqrt(p) with `decimals` fractional
  // digits — at most 1 wei of truncation error.
  const pScaled = priceRatio * scale; // p at 2*decimals
  const sqrtPScaled = bigintSqrtFloor(pScaled); // sqrt(p) at `decimals`

  // 2 * sqrt(p) / (1 + p) at `decimals`.
  const denom = one + priceRatio;
  const value = (two * sqrtPScaled) / denom; // ≈ IL at `decimals`

  // value is IL at `decimals` precision, sign convention:
  //   value ∈ [0, 1) when p != 1; value == 0 iff p == 1.
  // We want it in IL_SCALE (1e18) units. Multiply by the scale
  // factor: IL_SCALE / 10^decimals.
  const factor = IL_SCALE / scale; // exactly IL_SCALE / 10^decimals
  const remainder = IL_SCALE % scale;

  // value is in [0, scale), so value*factor + (value*remainder)/scale.
  const scaled = value * factor + (value * remainder) / scale;

  // IL(p) = value - 1 in the original real-number formula.
  // `value` here is already `IL(p) + 1` because we took
  // `2*sqrt(p)/(1+p)` directly. Convert to (IL * IL_SCALE):
  //   return value - IL_SCALE
  return scaled - IL_SCALE;
}

/**
 * Compute IL between two `Price`-shaped bigint/decimals pairs. The
 * price ratio is `newPrice / oldPrice` at `outDecimals` precision,
 * then fed through `ilFromPriceRatio`.
 *
 * @param newPrice - Current price (scaled bigint).
 * @param newDecimals - Decimals of `newPrice`.
 * @param oldPrice - Entry price (scaled bigint).
 * @param oldDecimals - Decimals of `oldPrice`.
 * @param outDecimals - Decimals of the computed ratio (default 18).
 * @returns IL scaled by IL_SCALE (1e18 == 100%).
 */
export function ilBetweenPrices(
  newPrice: bigint,
  newDecimals: number,
  oldPrice: bigint,
  oldDecimals: number,
  outDecimals: number = 18,
): bigint {
  if (newPrice <= 0n || oldPrice <= 0n) {
    throw new Error(`ilBetweenPrices requires positive prices, got new=${newPrice} old=${oldPrice}`);
  }

  // Build the price ratio `newPrice / oldPrice` at `outDecimals`
  // precision: resultScale = newDecimals - oldDecimals + outDecimals.
  const scaleDelta = newDecimals - oldDecimals + outDecimals;

  let ratio: bigint;
  if (scaleDelta >= 0) {
    ratio = newPrice * 10n ** BigInt(scaleDelta) / oldPrice;
  } else {
    ratio = newPrice / oldPrice / 10n ** BigInt(-scaleDelta);
  }

  return ilFromPriceRatio(ratio, outDecimals);
}