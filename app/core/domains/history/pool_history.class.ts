// app/core/domains/history/pool_history.class.ts

import type { PoolSnapshot } from './pool_snapshot.value-object';

/**
 * Aggregate holding the ordered snapshot history of a pool.
 *
 * Snapshots are kept in ascending block-number order. The class
 * provides simple range/filter queries over them.
 *
 * Implementations should treat this as an append-only log (e.g. coming
 * from a future history provider). For Phase 3, callers populate it
 * explicitly via {@link createPoolHistory}.
 */
export class PoolHistory {
  readonly pool: string;

  readonly chainId: number;

  private readonly snapshots: PoolSnapshot[];

  constructor(
    pool: string,
    chainId: number,
    initialSnapshots: readonly PoolSnapshot[] = [],
  ) {
    this.pool = pool;
    this.chainId = chainId;
    this.snapshots = [...initialSnapshots].sort(
      (a, b) => (a.blockNumber < b.blockNumber ? -1 : 1),
    );
  }

  /** Number of snapshots currently held. */
  size(): number {
    return this.snapshots.length;
  }

  /** All snapshots in ascending block order (fresh array). */
  toArray(): readonly PoolSnapshot[] {
    return [...this.snapshots];
  }

  /** Filter snapshots whose block is in `[fromBlock, toBlock]`. */
  inBlockRange(
    fromBlock: bigint,
    toBlock: bigint,
  ): readonly PoolSnapshot[] {
    return this.snapshots.filter(
      (s) => s.blockNumber >= fromBlock && s.blockNumber <= toBlock,
    );
  }

  /** Most recent snapshot, or `undefined` if the history is empty. */
  latest(): PoolSnapshot | undefined {
    return this.snapshots.at(-1);
  }

  /** Earliest snapshot, or `undefined` if the history is empty. */
  earliest(): PoolSnapshot | undefined {
    return this.snapshots[0];
  }

  /**
   * Compute a simple return `Price / priceAt(start)` ratio across the
   * snapshot range, returning `null` if fewer than two snapshots exist.
   * Used for percentage-based price moves.
   */
  priceMove(): bigint | null {
    const first = this.earliest();
    const last = this.latest();

    if (!first || !last || this.snapshots.length < 2) {
      return null;
    }

    return last.price.ratio(first.price, first.price.decimals).value;
  }
}
