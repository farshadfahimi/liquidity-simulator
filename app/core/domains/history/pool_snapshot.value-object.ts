// app/core/domains/history/pool_snapshot.value-object.ts

import type { TAddress } from '../../shared/types';
import { Price } from '../../shared/value_objects';

/**
 * A point-in-time snapshot of a pool: state at block N plus derived
 * price. Built from `TPoolState`-like data combined with a block number
 * and block timestamp.
 *
 * Snapshots are immutable; they're the unit of record for the
 * {@link PoolHistory} aggregate.
 */
export class PoolSnapshot {
  readonly pool: TAddress;

  readonly chainId: number;

  readonly blockNumber: bigint;

  readonly timestamp: bigint;

  readonly sqrtPriceX96: bigint;

  readonly tick: number;

  readonly liquidity: bigint;

  readonly price: Price;

  constructor(
    pool: TAddress,
    chainId: number,
    blockNumber: bigint,
    timestamp: bigint,
    sqrtPriceX96: bigint,
    tick: number,
    liquidity: bigint,
    price: Price,
  ) {
    this.pool = pool;
    this.chainId = chainId;
    this.blockNumber = blockNumber;
    this.timestamp = timestamp;
    this.sqrtPriceX96 = sqrtPriceX96;
    this.tick = tick;
    this.liquidity = liquidity;
    this.price = price;
  }
}
