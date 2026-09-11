// app/core/math/scoring.util.ts

/**
 * Composite scoring math for LP ranges.
 *
 * The simplest defensible composite is the Sharpe-like ratio:
 *
 *     score = (expectedAPR − riskFreeAPR) / volatility
 *
 * `expectedAPR` is the projected fee APR (e.g. from {@link aprFromFees}).
 * `riskFreeAPR` defaults to 0 — callers can override with a stablecoin
 * staking yield (e.g.5% aUSDC).
 * `volatility` is annualized realized vol (from
 * {@link realizedVolatility}).
 *
 * **All inputs use the same convention as `APR_SCALE` and
 * `VOLATILITY_SCALE` (1e18 == 100%).** The output is also scaled at
 * 1e18, so a "score of 1.0" means expected return / vol ratio = 1.0.
 *
 * NOTE: a negative score indicates risk-adjusted losses (APR < rf
 * rate) — usually undesirable. Callers may want to floor the score
 * at 0 if they're picking ranges by score. This function does NOT
 * floor; it returns the raw value.
 */

import { APR_SCALE } from './apr.util';
import { aprFromFees } from './apr.util';
import { VOLATILITY_SCALE } from './volatility.util';

/** Bigint scale used for scoring outputs (1e18 == 1.0 score unit). */
export const SCORE_SCALE = 1_000_000_000_000_000_000n; // 1e18

/**
 * Sharpe-like composite score.
 *
 * @param expectedApr - Expected APR at `APR_SCALE` precision.
 * @param volatility - Annualized volatility at `VOLATILITY_SCALE`
 *   precision. Must be > 0.
 * @param riskFreeApr - Risk-free APR at `APR_SCALE` precision
 *   (default 0).
 * @returns Score at `SCORE_SCALE` precision.
 */
export function sharpeLikeScore(
  expectedApr: bigint,
  volatility: bigint,
  riskFreeApr: bigint = 0n,
): bigint {
  if (volatility <= 0n) {
    throw new Error(`sharpeLikeScore: volatility must be positive, got ${volatility}`);
  }

  if (expectedApr < 0n) {
    throw new Error(`sharpeLikeScore: expectedApr must be non-negative, got ${expectedApr}`);
  }

  if (riskFreeApr < 0n) {
    throw new Error(`sharpeLikeScore: riskFreeApr must be non-negative, got ${riskFreeApr}`);
  }

  // (expectedApr − riskFreeApr) at APR_SCALE precision.
  const excess = expectedApr - riskFreeApr;

  // excess / vol. Both at 1e18 scale; ratio is dimensionless → at 1e18.
  return (excess * SCORE_SCALE) / volatility;
}

/**
 * Compute a Sharpe-like score from a `(fees, principal, window)` triple
 * plus realized vol. Convenience wrapper used by
 * {@link AnalyticsEngine.positionScore}.
 *
 * @param feesRaw - Fees collected in the period (raw).
 * @param principalRaw - Capital deployed (raw, same units).
 * @param windowSeconds - Window length in seconds.
 * @param volatilityAnnual - Annualized volatility at VOLATILITY_SCALE.
 * @param riskFreeApr - Risk-free APR override.
 * @param secondsPerYear - Override seconds-per-year.
 */
export function sharpeFromWindow(
  feesRaw: bigint,
  principalRaw: bigint,
  windowSeconds: bigint,
  volatilityAnnual: bigint,
  riskFreeApr: bigint = 0n,
  secondsPerYear: bigint = 31_557_600n,
): bigint {
  const apr = aprFromFees(feesRaw, principalRaw, windowSeconds, secondsPerYear);
  return sharpeLikeScore(apr, volatilityAnnual, riskFreeApr);
}

/**
 * Re-export the scale constants so the rest of the domain layer
 * doesn't need to know each module's home.
 */
export { APR_SCALE, VOLATILITY_SCALE };