// app/core/domains/pool/pool.class.ts

import type { TAddress } from '../../shared/types';
import { PoolStateVO, TickRange, formatAmount } from '../../shared';
import { Price } from '../../shared/value_objects';
import { tickToPrice } from '../../math';
import type { TPoolState } from '../../adapters/types';
import type { TTick } from '../../adapters/types';
import { PoolTickMap } from './pool_tick_map.value-object';

/**
 * Domain aggregate representing a single live pool at a moment in time.
 *
 * The `Pool` aggregate is the canonical "current state" handle inside
 * the Core domain. It carries:
 *   - {@link PoolStateVO} — the immutable pool state read from chain.
 *   - A sparse {@link PoolTickMap} — zero or more ticks loaded on demand.
 *
 * The factory {@link createPool} is what callers should use to construct
 * new instances; the constructor is intentionally permissive and lives
 * here for completeness. Use {@link Pool.withTicks} to fold additional
 * ticks in.
 */
export class Pool {
  readonly state: PoolStateVO;

  readonly ticks: PoolTickMap;

  readonly chainId: number;

  constructor(
    state: TPoolState,
    chainId: number,
    initialTicks: readonly TTick[] = [],
  ) {
    this.state = new PoolStateVO(state);
    this.ticks = new PoolTickMap(initialTicks);
    this.chainId = chainId;
  }

  /** Address of the pool. */
  get address(): TAddress {
    return this.state.pool;
  }

  /** Current price (token1 per token0) at 18 decimals by default. */
  currentPrice(decimals: number = 18): Price {
    return this.state.currentPrice(decimals);
  }

  /** All loaded ticks, ascending. */
  loadedTicks(): readonly TTick[] {
    return this.ticks.toArray();
  }

  /** Return a new `Pool` with `additional` ticks merged into the tick map. */
  withTicks(additional: readonly TTick[]): Pool {
    const merged = this.ticks.merge(additional);
    const rawState: TPoolState = {
      pool: this.state.pool,
      token0: this.state.token0,
      token1: this.state.token1,
      fee: this.state.fee,
      tickSpacing: this.state.tickSpacing,
      sqrtPriceX96: this.state.sqrtPriceX96,
      tick: this.state.tick,
      liquidity: this.state.liquidity,
      feeGrowthGlobal0X128: this.state.feeGrowthGlobal0X128,
      feeGrowthGlobal1X128: this.state.feeGrowthGlobal1X128,
    };

    return new Pool(rawState, this.chainId, merged.toArray());
  }

  /**
   * Human-readable description of the pool, e.g.
   *   "USDC/WETH 0.050%".
   *
   * `state.fee` is in hundredths of basis points (i.e. 500 == 0.05%,
   * 3000 == 0.30%, 10000 == 1.00%), so divide by 10_000 to get a
   * percentage. `toFixed(3)` keeps three decimal places so that the
   * 0.05% and 0.30% tiers display distinctly from "0.000%".
   */
  describe(): string {
    const feePercent = (this.state.fee / 10_000).toFixed(3);

    return `${this.state.token0.symbol}/${this.state.token1.symbol} ${feePercent}%`;
  }

  /**
   * Format `tokenAmount` (raw) as a human string, e.g. `1.5`.
   * Defaults to `token1` if no `which` is supplied.
   */
  formatAmount(amount: bigint, which: 'token0' | 'token1' = 'token1'): string {
    return formatAmount(amount, which === 'token0' ? this.state.token0.decimals : this.state.token1.decimals);
  }

  /**
   * Compute the price at `tick`, expressed at `decimals` of precision.
   * Useful for static analysis (e.g. range bounds).
   */
  priceAtTick(
    tick: number,
    decimals: number = 18,
  ): Price {
    return tickToPrice(
      tick,
      this.state.token0.decimals,
      this.state.token1.decimals,
      decimals,
    );
  }

  /**
   * Build a {@link TickRange} value object from raw ticks, validated.
   * Convenience so callers don't have to import the value object
   * directly.
   */
  makeRange(tickLower: number, tickUpper: number): TickRange {
    return new TickRange(tickLower, tickUpper);
  }
}
