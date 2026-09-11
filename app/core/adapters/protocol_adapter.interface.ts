// app/core/adapters/protocol_adapter.interface.ts

import type { TAddress } from '@core/shared/types';
import type { TPoolDiscovery } from './types/pool_discovery.type';
import type { TPoolState } from './types/pool_state.type';
import type { TQuotePosition } from './types/quote_position.type';
import type { TTick } from './types/tick.type';
import type { TTickRange } from './types/tick_range.type';

/**
 * Behavior contract every protocol adapter must implement. Adapters are
 * the ONLY place that knows how a specific DEX encodes pool state; they
 * translate everything into the protocol-neutral T* shapes above.
 */
export interface IProtocolAdapter {
  readonly id: string;

  readonly name: string;

  readonly version: string;

  /**
   * Enumerate the pools this adapter can serve. Implementations may use
   * an off-chain list, subgraph, or a curated registry.
   */
  discoverPools(): Promise<readonly TPoolDiscovery[]>;

  /**
   * Live state of a single pool at the latest block.
   */
  getPoolState(pool: TAddress): Promise<TPoolState>;

  /**
   * Historical state of a single pool pinned to a specific block
   * number. Used by the charts use case to build a snapshot
   * history. When the underlying RPC doesn't have archive state
   * for `blockNumber`, the implementation should throw a
   * recognisable error (we treat that as the trigger to fall
   * back to a synthetic history). Defaults to `getPoolState` for
   * adapters that don't need history.
   */
  getPoolStateAtBlock(
    pool: TAddress,
    blockNumber: bigint,
  ): Promise<TPoolState>;

  /**
   * Return tick data inside `[tickLower, tickUpper]` for a pool.
   */
  getTicks(
    pool: TAddress,
    range: TTickRange,
  ): Promise<readonly TTick[]>;

  /**
   * Quote a position by depositing `token0Amount` into `range`.
   */
  quotePosition(
    pool: TAddress,
    range: TTickRange,
    token0Amount: bigint,
  ): Promise<TQuotePosition>;
}
