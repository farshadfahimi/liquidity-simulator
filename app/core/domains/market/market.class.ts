// app/core/domains/market/market.class.ts

import type { TAddress } from '../../shared/types';
import { Pool } from '../pool';
import { Price } from '../../shared/value_objects';

/**
 * Market aggregate: wraps a {@link Pool} and exposes "current market
 * view" derived helpers.
 *
 * Conceptually distinct from `Pool`: a `Pool` is the on-chain AMM
 * contract's state; a `Market` is the *trading-market* view of that
 * pool (current price, what happens if you swap, etc.). For Phase 3,
 * `Market` is effectively a thin wrapper plus price-history hooks.
 *
 * Time-series concerns (volatility, candles, OHLC) belong here once
 * Phase 5 lands. For Phase 3 we ship the core shape only.
 */
export class Market {
  readonly pool: Pool;

  readonly chainId: number;

  /**
   * Number of decimals used by all "display" prices returned by
   * `currentPrice(...)`. Default 18 — re-exported as `Price` decimals.
   */
  readonly displayDecimals: number;

  constructor(
    pool: Pool,
    chainId: number,
    displayDecimals: number = 18,
  ) {
    this.pool = pool;
    this.chainId = chainId;
    this.displayDecimals = displayDecimals;
  }

  /** Address of the underlying pool. */
  get address(): TAddress {
    return this.pool.address;
  }

  /** Current spot price for `token1` in `token0` terms, at display decimals. */
  currentPrice(): Price {
    return this.pool.currentPrice(this.displayDecimals);
  }

  /** The current tick of the pool (a V3-style log-price). */
  get currentTick(): number {
    return this.pool.state.tick;
  }

  /** The pool's fee tier, in basis points × 1e-6 (e.g. 500 = 0.05%). */
  get feeTier(): number {
    return this.pool.state.fee;
  }

  /** Forward to the underlying pool's `describe()` helper. */
  describe(): string {
    return this.pool.describe();
  }

  /** Forward tick lookups (loaded ticks). */
  loadedTicks(): readonly (readonly (readonly [number, bigint, bigint])[]) {
    return this.pool.loadedTicks().map((t) => [t.index, t.liquidityGross, t.liquidityNet] as const);
  }
}
