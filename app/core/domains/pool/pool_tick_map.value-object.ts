// app/core/domains/pool/pool_tick_map.value-object.ts

import type { TTick } from '../../adapters/types';

/**
 * Immutable, sorted, sparse view of ticks currently known for a pool.
 *
 * Tick maps are *sparse*: only the ticks we explicitly queried are
 * stored. The map supports `at(tick)` exact lookups, `range(tickLower,
 * tickUpper)` filtered enumeration, and `merge(newTicks)` to fold in
 * additional ticks loaded on demand.
 *
 * Returns ticks sorted ascending by index; returned arrays are fresh
 * copies — mutating them does not affect the underlying map.
 */
export class PoolTickMap {
  private readonly ticks: Map<number, TTick>;

  constructor(initialTicks: readonly TTick[]) {
    this.ticks = new Map();
    for (const t of initialTicks) {
      this.ticks.set(t.index, t);
    }
  }

  /** Return the tick at exact `index`, or `undefined` if not loaded. */
  at(index: number): TTick | undefined {
    return this.ticks.get(index);
  }

  /** Number of ticks currently held in the map. */
  size(): number {
    return this.ticks.size;
  }

  /** All loaded tick indices, ascending. */
  indices(): readonly number[] {
    return Array.from(this.ticks.keys()).sort((a, b) => a - b);
  }

  /** All loaded ticks, ascending by index, as fresh `TTick[]` array. */
  toArray(): readonly TTick[] {
    return this.indices().map((idx) => this.ticks.get(idx)!);
  }

  /** Filter ticks whose index falls in `[tickLower, tickUpper]`. */
  inRange(
    tickLower: number,
    tickUpper: number,
  ): readonly TTick[] {
    const result: TTick[] = [];
    for (const idx of this.indices()) {
      if (idx >= tickLower && idx <= tickUpper) {
        result.push(this.ticks.get(idx)!);
      }
    }

    return result;
  }

  /** Sum the absolute net-liquidity delta across loaded ticks. */
  totalNetLiquidityDelta(): bigint {
    let total = 0n;
    for (const tick of this.ticks.values()) {
      if (tick.liquidityNet >= 0n) {
        total += tick.liquidityNet;
      } else {
        total -= tick.liquidityNet;
      }
    }

    return total;
  }

  /** Return a new map with `incoming` ticks merged in (overwrites). */
  merge(incoming: readonly TTick[]): PoolTickMap {
    const next = new PoolTickMap(this.toArray());

    for (const t of incoming) {
      next.ticks.set(t.index, t);
    }

    return next;
  }
}
