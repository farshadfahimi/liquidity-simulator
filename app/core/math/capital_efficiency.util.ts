// app/core/math/capital_efficiency.util.ts

/**
 * Capital-efficiency math for concentrated-liquidity (CL) AMMs.
 *
 * Two different notions live here — keep them apart:
 *
 * 1. **Capital efficiency (CE)** — {@link capitalEfficiencyRatio}.
 *    How much *more* liquidity a position over `[P_lower, P_upper]`
 *    provides per unit of capital than a full-range (V2-style)
 *    position funded with the same value at the same price `P`:
 *
 *        CE = 1 / (1 − ½·(√(P/P_u) + √(P_l/P)))
 *
 *    For `P = √(P_l·P_u)` this collapses to the white-paper form
 *    `1 / (1 − (P_l/P_u)^¼)`. CE is ≈ 1× for a (near) full range and
 *    grows as the range **narrows** (±10% ≈ 20×, ±5% ≈ 40×).
 *
 * 2. **Price-band ratio** — {@link priceBandRatio} = `P_upper / P_lower`.
 *    Pure geometry: it grows as the range **widens**. It is *not* a
 *    capital-efficiency measure and must never be used to rank ranges
 *    by efficiency (the pre-fix code did, which made every ranking
 *    prefer the widest candidate).
 *
 * All outputs are scaled bigints at `CAPITAL_EFFICIENCY_SCALE` (1e18)
 * so 1e18 == 1× and 2e19 == 20×.
 */

import { MIN_TICK, MAX_TICK, sqrtRatioAtTick } from './tick_math.util';
import { bigintLn } from './volatility.util';

/** Bigint scale used for capital-efficiency outputs (1e18 == 1×). */
export const CAPITAL_EFFICIENCY_SCALE = 1_000_000_000_000_000_000n; // 1e18

/**
 * Price-band ratio `P_upper / P_lower`. Returns a bigint at
 * `CAPITAL_EFFICIENCY_SCALE` precision (1e18 == 1.0).
 *
 * NOTE: this grows with range width. It is NOT capital efficiency —
 * see {@link capitalEfficiencyRatio}.
 *
 * @param tickLower - Lower tick of the CL range.
 * @param tickUpper - Upper tick of the CL range.
 * @returns Ratio at `CAPITAL_EFFICIENCY_SCALE` (1e18 == 1.0).
 */
export function priceBandRatio(
  tickLower: number,
  tickUpper: number,
): bigint {
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) {
    throw new Error(
      `priceBandRatio bounds must be integers, got ${tickLower}, ${tickUpper}`,
    );
  }

  if (tickLower < MIN_TICK || tickUpper > MAX_TICK) {
    throw new Error(
      `priceBandRatio out of bounds [${MIN_TICK}, ${MAX_TICK}], got [${tickLower}, ${tickUpper}]`,
    );
  }

  if (tickLower >= tickUpper) {
    throw new Error(
      `priceBandRatio lower must be < upper, got ${tickLower} >= ${tickUpper}`,
    );
  }

  // ratio = P_upper / P_lower = 1.0001^(tickUpper - tickLower).
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
    throw new Error('priceBandRatio: sqrt collapsed to 0 (out of bounds)');
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
 * Capital efficiency of a CL position versus a full-range position
 * of equal value at the same price:
 *
 *     CE = 1 / (1 − ½·(√(P/P_u) + √(P_l/P)))
 *
 * Everything is computed from ticks (via `sqrtRatioAtTick`), so token
 * decimals and price direction cancel out.
 *
 * @param tickLower - Lower tick of the CL range.
 * @param tickUpper - Upper tick of the CL range.
 * @param currentTick - Pool tick the position is opened at. Clamped
 *   into `[tickLower, tickUpper]` (an out-of-range position is
 *   single-sided; its CE at the nearest edge is returned). When
 *   omitted the midpoint of the range is used, i.e. the symmetric
 *   case `1 / (1 − (P_l/P_u)^¼)`.
 * @returns CE at `CAPITAL_EFFICIENCY_SCALE` (1e18 == 1×). Always ≥ 1×.
 */
export function capitalEfficiencyRatio(
  tickLower: number,
  tickUpper: number,
  currentTick?: number,
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

  if (currentTick !== undefined && !Number.isInteger(currentTick)) {
    throw new Error(`capitalEfficiencyRatio currentTick must be an integer, got ${currentTick}`);
  }

  const tick = Math.min(
    Math.max(currentTick ?? Math.round((tickLower + tickUpper) / 2), tickLower),
    tickUpper,
  );

  const sqrtP = sqrtRatioAtTick(tick);
  const sqrtL = sqrtRatioAtTick(tickLower);
  const sqrtU = sqrtRatioAtTick(tickUpper);

  const a = (sqrtP * CAPITAL_EFFICIENCY_SCALE) / sqrtU; // √(P/P_u) ≤ 1
  const b = (sqrtL * CAPITAL_EFFICIENCY_SCALE) / sqrtP; // √(P_l/P) ≤ 1
  const denom = CAPITAL_EFFICIENCY_SCALE - (a + b) / 2n;

  if (denom <= 0n) {
    throw new Error(
      `capitalEfficiencyRatio: denominator collapsed at [${tickLower}, ${tickUpper}] tick ${tick}`,
    );
  }

  return (CAPITAL_EFFICIENCY_SCALE * CAPITAL_EFFICIENCY_SCALE) / denom;
}

/** Scale of {@link capitalEfficiencyFactor} (1e18 == 1.0, same as `SCORE_SCALE`). */
export const CE_FACTOR_SCALE = 1_000_000_000_000_000_000n;

/**
 * CE at which {@link capitalEfficiencyFactor} saturates (100×, roughly
 * a ±1% range). Chosen so the factor still separates ±5% / ±10% /
 * ±20% / ±50% candidates.
 */
export const CE_FACTOR_CEILING = 100n * CAPITAL_EFFICIENCY_SCALE;

/**
 * Normalise CE into `[0, 1]` on a log scale: `ln(CE) / ln(ceiling)`.
 * 1× (full range) → 0, `ceiling` and above → 1. Log scale because CE
 * explodes for narrow ranges while the interesting differences
 * between candidates are multiplicative.
 *
 * @param ce - CE at `CAPITAL_EFFICIENCY_SCALE`.
 * @param ceiling - CE that maps to 1.0 (default {@link CE_FACTOR_CEILING}).
 * @returns Factor at {@link CE_FACTOR_SCALE}.
 */
export function capitalEfficiencyFactor(
  ce: bigint,
  ceiling: bigint = CE_FACTOR_CEILING,
): bigint {
  if (ceiling <= CAPITAL_EFFICIENCY_SCALE) {
    throw new Error(`capitalEfficiencyFactor ceiling must be > 1×, got ${ceiling}`);
  }

  if (ce <= CAPITAL_EFFICIENCY_SCALE) {
    return 0n;
  }

  if (ce >= ceiling) {
    return CE_FACTOR_SCALE;
  }

  const factor = (bigintLn(ce, 18) * CE_FACTOR_SCALE) / bigintLn(ceiling, 18);

  if (factor < 0n) {
    return 0n;
  }

  return factor > CE_FACTOR_SCALE ? CE_FACTOR_SCALE : factor;
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