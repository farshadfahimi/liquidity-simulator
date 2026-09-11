// app/core/domains/simulation/deposit_simulation.class.ts

import type { Pool } from '../pool';
import type { Position } from '../position';
import type { ISimulation } from './simulation.interface';

/**
 * Input for {@link DepositSimulation}.
 *
 * `token0Amount` is the caller's intended deposit amount for
 * `token0` (raw bigint). The simulation reports the fill ratio
 * against the actual amount the position requires to mint at the
 * requested range — the surplus remains un-deposited.
 *
 * If `token0Amount` is `0n`, the simulation still emits the
 * required amounts but `fillRatio = 0n`.
 */
export interface IDepositSimulationInput {
  /** Caller's intended deposit amount for `token0`, in raw bigint. */
  token0Amount: bigint;
}

/**
 * Output of {@link DepositSimulation}: deposit-time metrics for the
 * candidate position.
 *
 * - `lowerPrice` / `upperPrice` — the price bounds of the candidate
 *   range at the requested `decimals` (defaults to 18). These are
 *   static: they describe the *position*, not the pool's current
 *   tick. The "side" field carries the latter.
 * - `liquidity` / `amount0` / `amount1` — the position's quoted
 *   values (echoed for convenience).
 * - `currentlyInRange` / `side` — current state of the pool vs the
 *   position's range.
 * - `fillRatio` — `position.amount0 / token0Amount` at 1e18 == 1.0.
 *   Returns `0n` if the caller asked for zero `token0` and `1e18`
 *   if the requested amount fully funds the position.
 */
export interface IDepositSimulationOutput {
  /** Whether the position is currently in-range (would earn fees). */
  currentlyInRange: boolean;

  /** Side of the current tick relative to the position. */
  side: 'below' | 'inside' | 'above';

  /** Liquidity delta vs the existing position this simulation tested. */
  liquidity: bigint;

  /** Token amounts required to open this position (raw). */
  amount0: bigint;

  /** Token amounts required to open this position (raw). */
  amount1: bigint;

  /** Lower bound of the range as a numeraire price (at `decimals`). */
  lowerPrice: bigint;

  /** Upper bound of the range as a numeraire price (at `decimals`). */
  upperPrice: bigint;

  /** Decimal scale used for `lowerPrice` / `upperPrice`. */
  decimals: number;

  /**
   * Ratio `token0Amount actually consumed / token0Amount requested` —
   * useful when the requested amount exceeds what's needed for the
   * range (the surplus remains un-deposited). Scaled to 18 decimals.
   */
  fillRatio: bigint;
}

/**
 * Level-1 simulation: deposit at current state. Computes whether the
 * candidate position would be in-range at the current tick and reports
 * the requested-vs-actually-used `token0` fill ratio, plus the
 * position's price bounds.
 *
 * Pure: no IO. The position amounts come from the caller (e.g. a
 * quoter) — the simulation does *not* re-quote.
 */
export class DepositSimulation
  implements ISimulation<IDepositSimulationInput, IDepositSimulationOutput>
{
  readonly id = 'deposit';

  /**
   * Default decimals used for `lowerPrice` / `upperPrice` in the
   * output. 18 keeps the math consistent with the rest of Core
   * (IL_SCALE, etc.).
   */
  static readonly DEFAULT_DECIMALS = 18;

  run(
    input: IDepositSimulationInput,
    pool: Pool,
    position: Position,
  ): IDepositSimulationOutput {
    const tick = pool.state.tick;
    let side: IDepositSimulationOutput['side'] = 'inside';

    if (tick < position.range.tickLower) {
      side = 'below';
    } else if (tick >= position.range.tickUpper) {
      side = 'above';
    }

    let fillRatio: bigint;

    if (input.token0Amount === 0n) {
      fillRatio = 0n;
    } else if (position.amount0 === 0n) {
      // Position is concentrated above tick → 100% token1, fill on token0 is zero.
      fillRatio = 0n;
    } else if (input.token0Amount <= position.amount0) {
      // Caller asked for less than or equal to the full position's
      // `token0` requirement — the deposit uses everything.
      fillRatio = 10n ** 18n;
    } else {
      // Caller asked for more than the range needs.
      fillRatio = (position.amount0 * 10n ** 18n) / input.token0Amount;
    }

    const decimals = DepositSimulation.DEFAULT_DECIMALS;
    const lowerPrice = pool.priceAtTick(position.range.tickLower, decimals).value;
    const upperPrice = pool.priceAtTick(position.range.tickUpper, decimals).value;

    return {
      currentlyInRange: side === 'inside',
      side,
      liquidity: position.liquidity,
      amount0: position.amount0,
      amount1: position.amount1,
      lowerPrice,
      upperPrice,
      decimals,
      fillRatio,
    };
  }
}
