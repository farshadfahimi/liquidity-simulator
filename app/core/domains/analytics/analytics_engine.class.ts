// app/core/domains/analytics/analytics_engine.class.ts

import { TickRange, Price } from '../../shared/value_objects';
import { formatAmount } from '../../shared/utils';
import {
  IL_SCALE,
  CAPITAL_EFFICIENCY_SCALE,
  VOLATILITY_SCALE,
  APR_SCALE,
  SCORE_SCALE,
  ilBetweenPrices,
  capitalEfficiencyRatio,
  realizedVolatility,
  aprFromFees,
  sharpeLikeScore,
} from '../../math';
import type { IPriceObservation, IVolatilityResult } from '../../math';
import type { Pool } from '../pool';
import type { PoolHistory } from '../history';
import type { Position } from '../position';

/**
 * Pure, protocol-agnostic analytics engine. Computes derived metrics
 * from the domain aggregates produced by Core. **No on-chain reads.**
 *
 * Metrics implemented in Phase 3:
 *   - Current price (delegated to `Pool.currentPrice(...)`).
 *   - Range-in-price: convert a tick range to a [lowerPrice, upperPrice]
 *     pair at a given decimals scale.
 *   - Position-in-range check: is the pool's current tick inside the
 *     range of a given position?
 *   - Total notional deposit (raw + human-formatted strings).
 *   - History return: ratio of latest/earliest snapshot price.
 *
 * Metrics added in Phase 4 (math layer):
 *   - IL between two arbitrary prices.
 *   - Capital-efficiency ratio for a tick range.
 *   - Realized (log-return) volatility from a price-observation
 *     series.
 *   - APR from observed fees over a window.
 *   - Sharpe-like score combining expected APR + vol.
 */
export class AnalyticsEngine {
  constructor() {}

  /**
   * Return the price band `[lowerPrice, upperPrice]` for a tick range.
   * `decimals` defaults to 18.
   */
  rangePrices(
    pool: Pool,
    range: TickRange,
    decimals: number = 18,
  ): { lowerPrice: Price; upperPrice: Price } {
    return {
      lowerPrice: pool.priceAtTick(range.tickLower, decimals),
      upperPrice: pool.priceAtTick(range.tickUpper, decimals),
    };
  }

  /**
   * Is the pool's current tick inside the position's range? Returns a
   * tuple: `[inRange, side]` where `side` is 'below' | 'inside' | 'above'.
   */
  positionSide(
    pool: Pool,
    position: Position,
  ): {
    inRange: boolean;
    side: 'below' | 'inside' | 'above';
  } {
    const tick = pool.state.tick;

    if (tick < position.range.tickLower) {
      return { inRange: false, side: 'below' };
    }

    if (tick >= position.range.tickUpper) {
      return { inRange: false, side: 'above' };
    }

    return { inRange: true, side: 'inside' };
  }

  /**
   * Sum total notional deposited into a position at `decimals` of
   * scaling. Returns raw (bigint) and human-formatted strings for both
   * tokens.
   *
   * NOTE: this is a *raw sum*; IL-aware valuation (i.e. what's the
   * dollar value of this position right now?) lands in Phase 4.
   */
  totalDeposit(position: Position, pool: Pool): {
    token0Raw: bigint;
    token1Raw: bigint;
    token0Human: string;
    token1Human: string;
  } {
    const token0Human = formatAmount(position.amount0, pool.state.token0.decimals);
    const token1Human = formatAmount(position.amount1, pool.state.token1.decimals);

    return {
      token0Raw: position.amount0,
      token1Raw: position.amount1,
      token0Human,
      token1Human,
    };
  }

  /**
   * Compute the simple spot price return between the earliest and latest
   * snapshots in `history`. Returns `null` if fewer than 2 snapshots.
   */
  historyReturn(history: PoolHistory): {
    ratio: bigint;
    decimals: number;
  } | null {
    const r = history.priceMove();

    if (r === null) {
      return null;
    }

    const d = history.latest()?.price.decimals ?? 18;
    return { ratio: r, decimals: d };
  }

  // -----------------------------------------------------------------
  // Phase 4 metrics
  // -----------------------------------------------------------------

  /**
   * Impermanent loss between `entryPrice` (the price at which the
   * position was minted) and the pool's *current* price. Returns IL
   * at `IL_SCALE` precision (1e18 == 100%).
   *
   * Sign convention: IL ≤ 0 means a *loss* vs HODL (IL=0 means
   * no change; IL=-2e16 means a -2% loss).
   *
   * This is the V2-style "concentrated" IL applied to the spot
   * price ratio — i.e. it answers "what would have been my IL if
   * I'd put the same notional into V2 instead?". A CL position
   * that *exits* the range typically realizes *worse* IL than
   * this scalar; the caller should combine with `positionSide(...)`
   * for the full picture.
   */
  ilAtCurrentPrice(
    pool: Pool,
    entryPrice: Price,
  ): bigint {
    const currentPrice = pool.currentPrice(entryPrice.decimals);
    return ilBetweenPrices(
      currentPrice.value,
      currentPrice.decimals,
      entryPrice.value,
      entryPrice.decimals,
      entryPrice.decimals,
    );
  }

  /**
   * Compute the CL capital-efficiency ratio for a tick range.
   *
   * `ceRatio = P_upper / P_lower`, scaled at
   * `CAPITAL_EFFICIENCY_SCALE` (1e18 == 1× V2-equivalent). A range
   * of 2× in price yields CE=2; 10× yields CE=10.
   */
  capitalEfficiency(range: TickRange): bigint {
    return capitalEfficiencyRatio(range.tickLower, range.tickUpper);
  }

  /**
   * Compute realized (log-return) volatility from a series of price
   * observations. `observations` must be chronological and share
   * decimals.
   */
  volatility(observations: readonly IPriceObservation[]): IVolatilityResult {
    return realizedVolatility(observations);
  }

  /**
   * Compute realized volatility from `PoolSnapshot`-shaped price
   * observations. Convenience wrapper.
   */
  volatilityFromHistory(history: PoolHistory): IVolatilityResult | null {
    const arr = history.toArray();
    if (arr.length < 2) {
      return null;
    }

    const prices = arr.map((s) => s.price);
    const timestamps = arr.map((s) => s.timestamp);

    return realizedVolatility(
      prices.map((p, i) => ({
        price: p.value,
        decimals: p.decimals,
        timestamp: timestamps[i]!,
      })),
    );
  }

  /**
   * Compute APR from observed fees/principal over a window. Both
   * `feesRaw` and `principalRaw` are denominated in the *same*
   * token's smallest units (typically a numeraire like USDC).
   * Output at `APR_SCALE` (1e18 == 100% APR).
   */
  apr(
    feesRaw: bigint,
    principalRaw: bigint,
    windowSeconds: bigint,
  ): bigint {
    return aprFromFees(feesRaw, principalRaw, windowSeconds);
  }

  /**
   * Compute a Sharpe-like score from `expectedApr` + `riskFreeApr`
   * + `volatility`. All inputs at their natural 1e18 scales. Output
   * at `SCORE_SCALE` (1e18 == 1.0).
   */
  score(
    expectedApr: bigint,
    volatility: bigint,
    riskFreeApr: bigint = 0n,
  ): bigint {
    return sharpeLikeScore(expectedApr, volatility, riskFreeApr);
  }

  /**
   * Compute a Sharpe-like score from a fee window + realized
   * volatility. Convenience helper that wires the APR + score
   * pipeline.
   */
  scoreFromWindow(
    feesRaw: bigint,
    principalRaw: bigint,
    windowSeconds: bigint,
    volatilityAnnual: bigint,
    riskFreeApr: bigint = 0n,
  ): bigint {
    const expectedApr = aprFromFees(feesRaw, principalRaw, windowSeconds);
    return sharpeLikeScore(expectedApr, volatilityAnnual, riskFreeApr);
  }

  /**
   * Compose IL + CE + side metrics for a position over a pool. Useful
   * for one-shot "is this a good range?" checks.
   */
  positionMetrics(
    pool: Pool,
    position: Position,
    entryPrice: Price,
  ): {
    il: bigint;
    ce: bigint;
    inRange: boolean;
    side: 'below' | 'inside' | 'above';
  } {
    const side = this.positionSide(pool, position);
    return {
      il: this.ilAtCurrentPrice(pool, entryPrice),
      ce: this.capitalEfficiency(position.range),
      inRange: side.inRange,
      side: side.side,
    };
  }
}

// Re-export scale constants so callers don't need to import from
// `@core/math` separately.
export {
  IL_SCALE,
  CAPITAL_EFFICIENCY_SCALE,
  VOLATILITY_SCALE,
  APR_SCALE,
  SCORE_SCALE,
};