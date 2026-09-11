// app/core/math/capital_efficiency.util.ts

/**
 * Capital-efficiency math for concentrated-liquidity (CL) AMMs.
 *
 * Two related notions:
 *
 * 1. **Price-band ratio** — `P_upper / P_lower`. This is the most
 *    common way to express "how much tighter is this range than V2?".
 *    A V2 full-range position over `[P_min, MAX]` has ratio ≈ ∞;
 *    a CL position over `[P_lower, P_upper]` has ratio = P_upper/P_lower.
 *    A 2× range (e.g. prices from $2000 to $4000) ⇒ CE = 2; a
 *    10× range ⇒ CE = 10. This is the metric most DeFi dashboards
 *    display under "Capital efficiency" / "Multiplier".
 *
 * 2. **Tick-space CE ratio** — `Δ√P(active) / Δ√P(full)`. Equivalent
 *    up to a constant factor; useful for sanity-checking, less
 *    intuitive to display.
 *
 * All outputs are scaled bigints at `CAPITAL_EFFICIENCY_SCALE` (1e18)
 * so 1e18 == "1× V2-equivalent capital" and 1e19 == "10× CE".
 *
 * NOTE: the price-band ratio is **dimensionally a pure ratio**, so
 * token decimals do *not* cancel — `P_upper / P_lower` is the same
 * dimensionless number regardless of how you scale the prices, as
 * long as both are scaled identically.
 */

import { MIN_TICK, MAX_TICK, sqrtRatioAtTick } from './tick_math.util';

/** Bigint scale used for capital-efficiency outputs (1e18 == 1×). */
export const CAPITAL_EFFICIENCY_SCALE = 1_000_000_000_000_000_000n; // 1e18

/**
 * Capital-efficiency ratio expressed as `P_upper / P_lower`. Returns a
 * bigint at `CAPITAL_EFFICIENCY_SCALE` precision.
 *
 * This is the most common "concentration multiplier" used in DeFi UI.
 *
 * @param tickLower - Lower tick of the CL range.
 * @param tickUpper - Upper tick of the CL range.
 * @returns CE at `CAPITAL_EFFICIENCY_SCALE` (1e18 == 1×).
 */
export function capitalEfficiencyRatio(
  tickLower: number,
  tickUpper: number,
): bigint {
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) {
    throw new Error(
      `capitalEfficiencyRatio bounds must be integers, got ${tickLower}, ${tickUpper}`,
    );
  }

  if (tickLower < MIN_TICK || tickUpper > MAX_TICK) {
    throw new Error(
      `capitalEfficiencyRatio out of bounds [${MIN_TICK}, ${MAX_TICK}], got [${tickLower}, ${tickUpper}]`,
    );
  }

  if (tickLower >= tickUpper) {
    throw new Error(
      `capitalEfficiencyRatio lower must be < upper, got ${tickLower} >= ${tickUpper}`,
    );
  }

  // CE = P_upper / P_lower = 1.0001^(tickUpper - tickLower).
  // We compute this in tick-space: exponentiate by the *delta*
  // directly using the same mul-shift pipeline as `sqrtRatioAtTick`,
  // but the *result* here is the squared sqrt ratio so we skip the
  // final /2^32 step. To stay safe and simple, we go through the
  // price-sqrt route:
  //
  //   p(tick) = (sqrtRatioAtTick(tick)^2) / 2^192 * 10^(d1 - d0)
  //
  // We pick d0 = d1 = 0 so the 10^() factor is 1; that cancels in
  // the ratio. So `price = sqrt^2 / 2^192`, and we want
  // `priceUpper / priceLower = sqrtU^2 / sqrtL^2`.

  const sqrtLower = sqrtRatioAtTick(tickLower);
  const sqrtUpper = sqrtRatioAtTick(tickUpper);

  if (sqrtUpper === 0n || sqrtLower === 0n) {
    throw new Error('capitalEfficiencyRatio: sqrt collapsed to 0 (out of bounds)');
  }

  // CE = (sqrtUpper / sqrtLower)^2 — but the square on a ratio
  // collapses to sqrtUpper^2 / sqrtLower^2, which avoids one bigint
  // division. Both `sqrtLower` and `sqrtUpper` are Q64.96, so the
  // squared values are Q128.192 (i.e. up to 384 bits), comfortably
  // within JS bigint range.
  const sqU = sqrtUpper * sqrtUpper;
  const sqL = sqrtLower * sqrtLower;

  // CE = sqU / sqL, scaled to CAPITAL_EFFICIENCY_SCALE.
  return (sqU * CAPITAL_EFFICIENCY_SCALE) / sqL;
}

/**
 * Tick-space CE ratio `Δ√P(active) / Δ√P(full-range)`. Useful for
 * sanity-checking the price-band ratio; same units (1e18 == 1×).
 *
 * NOTE: For symmetric ranges around the current tick, this is
 * numerically close to the price-band ratio divided by the same
 * full-range constant, but the *price-band* form above is the
 * one most users care about.
 */
export function capitalEfficiencyVsFullRange(
  tickLower: number,
  tickUpper: number,
): bigint {
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) {
    throw new Error(
      `capitalEfficiencyVsFullRange bounds must be integers, got ${tickLower}, ${tickUpper}`,
    );
  }

  if (tickLower < MIN_TICK || tickUpper > MAX_TICK) {
    throw new Error(
      `capitalEfficiencyVsFullRange out of bounds [${MIN_TICK}, ${MAX_TICK}], got [${tickLower}, ${tickUpper}]`,
    );
  }

  if (tickLower >= tickUpper) {
    throw new Error(
      `capitalEfficiencyVsFullRange lower must be < upper, got ${tickLower} >= ${tickUpper}`,
    );
  }

  const halfLower = Math.floor(tickLower / 2);
  const halfUpper = Math.floor(tickUpper / 2);
  const sqrtP_lower = sqrtRatioAtTick(halfLower);
  const sqrtP_upper = sqrtRatioAtTick(halfUpper);

  if (sqrtP_upper <= sqrtP_lower) {
    throw new Error(
      `capitalEfficiencyVsFullRange: √p collapsed at [${tickLower}, ${tickUpper}]`,
    );
  }

  const activeDelta = sqrtP_upper - sqrtP_lower;
  const halfMax = Math.floor(MAX_TICK / 2);
  const fullDelta = 2n * sqrtRatioAtTick(halfMax);

  if (fullDelta <= 0n) {
    throw new Error('capitalEfficiencyVsFullRange: full-range delta collapsed');
  }

  return (activeDelta * CAPITAL_EFFICIENCY_SCALE) / fullDelta;
}