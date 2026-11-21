// app/core/domains/pool/pool.class.ts

import type { TAddress } from '../../shared/types';
import { PoolStateVO, TickRange, formatAmount } from '../../shared';
import { Price } from '../../shared/value_objects';
import { tickToPrice } from '../../math';
import type { TVirtualReserves } from '../../math';
import { virtualReserves } from '../../math';
import type { TPoolState } from '../../adapters/types';
import type { TTick } from '../../adapters/types';
import { PoolTickMap } from './pool_tick_map.value-object';

/**
 * Scale used by the internal price arithmetic of
 * {@link Pool.tvlToken0}. The pool price is always computed at 18
 * decimals so the fixed-point multiplication below stays exact.
 */
const TVL_PRICE_DECIMALS = 18;

/**
 * Re-scale a fixed-point value from `from` decimals to `to`
 * decimals (truncating when shrinking).
 */
function rescale(value: bigint, from: number, to: number): bigint {
  if (to >= from) {
    return value * 10n ** BigInt(to - from);
  }

  return value / 10n ** BigInt(from - to);
}

/**
 * Domain aggregate representing a single live pool at a moment in time.
 *
 * The `Pool` aggregate is the canonical "current state" handle inside
 * the Core domain. It carries:
 *   - {@link PoolStateVO} — the immutable pool state read from chain.
 *   - A sparse {@link PoolTickMap} — zero or more ticks loaded on demand.
 *
 * On-chain liquidity value (the TVL baseline) is exposed through
 * {@link Pool.virtualReserves} and {@link Pool.tvlToken0} — both are
 * pure and need no network access.
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
   * Virtual reserves of the pool's **active** liquidity — the
   * on-chain TVL baseline, computed without any external API.
   *
   * The two legs are raw token amounts:
   *
   *     amount0 = L × 2^96 / sqrtPriceX96
   *     amount1 = L × sqrtPriceX96 / 2^96
   *
   * Only the liquidity active at the current tick is counted, so this
   * *understates* pools whose liquidity sits mostly outside the tick.
   * Callers must label the result as an estimate.
   */
  virtualReserves(): TVirtualReserves {
    return virtualReserves(
      this.state.liquidity,
      this.state.sqrtPriceX96,
    );
  }

  /**
   * Total pool value denominated in **token0** (the pool's own
   * numeraire), at `decimals` of precision.
   *
   * Leg 0 is 1:1 with token0. Leg 1 (the token1 reserve) is converted
   * at the pool's current price, which is quoted as *token1 per
   * token0* — so the conversion is a **division**:
   *
   *     token0_amount = token1_amount / price
   *
   * The arithmetic runs on raw bigints (`Price` exposes `ratio`, a
   * division, but not a reciprocal), so the result stays exact.
   *
   * This is the "token-unit TVL" tier of the TVL fallback chain: it
   * needs no network call and no USD price at all.
   */
  tvlToken0(decimals: number = TVL_PRICE_DECIMALS): Price {
    const { amount0Raw, amount1Raw } = this.virtualReserves();
    const token0Decimals = this.state.token0.decimals;
    const token1Decimals = this.state.token1.decimals;

    // token1 per token0, at 18 decimals of precision.
    const price = this.currentPrice(TVL_PRICE_DECIMALS);

    if (price.value <= 0n) {
      throw new Error(
        `tvlToken0: pool price collapsed to zero (${price.value}); `
        + 'cannot value the token1 leg in token0',
      );
    }

    // Leg 0 — token0 raw amount, re-scaled to the price scale.
    const leg0 = rescale(amount0Raw, token0Decimals, TVL_PRICE_DECIMALS);

    // Leg 1 — token1 raw amount divided by the price:
    //   token0_human = (amount1Raw / 10^d1) / (price.value / 10^18)
    // scaled back up to 18 decimals:
    //   value = amount1Raw × 10^36 / (10^d1 × price.value)
    const leg1 = (amount1Raw * 10n ** 36n)
      / (10n ** BigInt(token1Decimals) * price.value);

    const total = leg0 + leg1;

    return new Price(
      rescale(total, TVL_PRICE_DECIMALS, decimals),
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
