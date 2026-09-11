// app/core/domains/position/position.class.ts

import { TickRange } from '../../shared/value_objects';
import type { TAddress } from '../../shared/types';
import type { TTickRange } from '../../adapters/types';
import type { TQuotePosition } from '../../adapters/types';

/**
 * Domain aggregate representing a hypothetical LP position over a
 * `tickLower..tickUpper` range. Carries the amounts required to mint,
 * the resulting `liquidity`, and the addresses the position is on.
 *
 * `Position` instances are immutable. To recompute, build a new one via
 * {@link createPosition} or the adapter's `quotePosition(...)`.
 */
export class Position {
  readonly pool: TAddress;

  readonly range: TickRange;

  readonly liquidity: bigint;

  readonly amount0: bigint;

  readonly amount1: bigint;

  readonly token0: TAddress;

  readonly token1: TAddress;

  constructor(
    pool: TAddress,
    range: TickRange,
    liquidity: bigint,
    amount0: bigint,
    amount1: bigint,
    token0: TAddress,
    token1: TAddress,
  ) {
    this.pool = pool;
    this.range = range;
    this.liquidity = liquidity;
    this.amount0 = amount0;
    this.amount1 = amount1;
    this.token0 = token0;
    this.token1 = token1;
  }

  /** Was this position built from a zero/empty quote? */
  isEmpty(): boolean {
    return this.liquidity === 0n && this.amount0 === 0n && this.amount1 === 0n;
  }

  /** Return the position as a `TQuotePosition` (protocol-neutral wire shape). */
  toQuote(): TQuotePosition {
    return {
      pool: this.pool,
      token0Amount: this.amount0,
      token1Amount: this.amount1,
      liquidity: this.liquidity,
      tickLower: this.range.tickLower,
      tickUpper: this.range.tickUpper,
      token0: this.token0,
      token1: this.token1,
    };
  }

  /**
   * Build a `Position` from the protocol-neutral `TQuotePosition`
   * shape (e.g. as returned by an adapter's `quotePosition(...)` call).
   */
  static fromQuote(
    pool: TAddress,
    quote: TQuotePosition,
  ): Position {
    const range = new TickRange(quote.tickLower, quote.tickUpper);

    return new Position(
      pool,
      range,
      quote.liquidity,
      quote.token0Amount,
      quote.token1Amount,
      quote.token0,
      quote.token1,
    );
  }

  /** Build a `Position` directly from raw ticks and amounts. */
  static fromRaw(
    pool: TAddress,
    tickLower: number,
    tickUpper: number,
    token0: TAddress,
    token1: TAddress,
    liquidity: bigint,
    amount0: bigint,
    amount1: bigint,
  ): Position {
    const range = new TickRange(tickLower, tickUpper);

    return new Position(pool, range, liquidity, amount0, amount1, token0, token1);
  }

  /** Underlying tick range as a `TTickRange` plain object. */
  toRawRange(): TTickRange {
    return {
      tickLower: this.range.tickLower,
      tickUpper: this.range.tickUpper,
    };
  }
}
