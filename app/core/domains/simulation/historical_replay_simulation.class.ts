// app/core/domains/simulation/historical_replay_simulation.class.ts

import {
  APR_SCALE,
  IL_SCALE,
  SECONDS_PER_YEAR,
  ilBetweenPrices,
} from '../../math';
import type { PoolHistory } from '../history';
import type { Price } from '../../shared/value_objects';
import type { Pool } from '../pool';
import type { Position } from '../position';
import type { ISimulation } from './simulation.interface';

/**
 * Options for {@link HistoricalReplaySimulation}.
 *
 * `history` is supplied at *construction time* rather than via the
 * `run` input. This keeps the {@link ISimulation} signature
 * (`run(input, pool, position)`) stable across all simulation
 * levels — Phase 3's `DepositSimulation` and Phase 5's other
 * simulations don't need history.
 *
 * For multi-pool backtests, instantiate a fresh
 * `HistoricalReplaySimulation` per `PoolHistory`.
 */
export interface IHistoricalReplaySimulationOptions {
  /**
   * Snapshot history to replay. Must be in chronological order
   * (i.e. `PoolHistory.toArray()` order); the simulation sorts
   * nothing.
   */
  readonly history: PoolHistory;
}

/**
 * Input for {@link HistoricalReplaySimulation.run}.
 *
 * The simulation models fees as a flat per-second rate, accrued
 * whenever the position is in-range. Unit conventions:
 *
 *   - `principalInNumeraire` — notional in raw numeraire units
 *     (e.g. 6-dec USDC). The simulation multiplies `feeRatePerSecond`
 *     by this to convert fractional fees into raw fees.
 *   - `feeRatePerSecond` — fees per second expressed as a
 *     **fraction** of `principalInNumeraire` at 1e18 precision
 *     (i.e. 1e18 == 1.0 == "100% of principal per second"). So
 *     if you want `30% APR`, pass
 *
 *         feeRatePerSecond = (apr_fraction_1e18) / SECONDS_PER_YEAR
 *
 *     with `apr_fraction_1e18 = 3 * 10^17`. The simulation then
 *     multiplies by `principal × dt / 1e18` to land in numeraire
 *     raw units.
 *
 *     This avoids the rounding-to-zero trap you'd hit if you tried
 *     to pre-compute `fees_per_sec_raw = principal × apr_unitless /
 *     spy` directly: for a 6-dec numeraire at 30% APR the per-second
 *     rate in raw units is < 1 and would truncate to 0.
 *
 *   - `numeraireToken` selects which token the principal + fees are
 *     denominated in. Doesn't affect the IL computation.
 */
export interface IHistoricalReplaySimulationInput {
  /** Entry price — the price at which the LP would have entered. */
  readonly entryPrice: Price;

  /**
   * Per-second fee rate as a *fraction* of principal at 1e18
   * precision. Caller pre-computes from a target APR:
   *
   *     feeRatePerSecond = apr_fraction_1e18 / SECONDS_PER_YEAR
   *
   * where `apr_fraction_1e18` is the APR at 1e18 precision
   * (1e18 == 100%/year).
   */
  readonly feeRatePerSecond: bigint;

  /** Principal in numeraire raw units. */
  readonly principalInNumeraire: bigint;

  /** Which token the principal + fees are denominated in. */
  readonly numeraireToken: 'token0' | 'token1';
}

/**
 * One row in the per-step sample stream of
 * {@link IHistoricalReplaySimulationOutput}. Useful for charting
 * later (e.g. "plot IL over time").
 */
export interface IHistoricalReplaySample {
  /** Snapshot index in `history.toArray()`. 0 = entry, etc. */
  readonly snapshotIndex: number;

  /** Snapshot timestamp (unix seconds). */
  readonly timestamp: bigint;

  /** Snapshot block number. */
  readonly blockNumber: bigint;

  /** Snapshot price at scale `price.decimals`. */
  readonly price: bigint;
  readonly priceDecimals: number;

  /** Side relative to the position at this snapshot. */
  readonly side: 'below' | 'inside' | 'above';

  /** Was the position in-range at this snapshot? */
  readonly inRange: boolean;

  /** IL at this snapshot's price vs the entry price, at IL_SCALE. */
  readonly il: bigint;

  /** Fees accrued during [prev_snapshot, this_snapshot], raw. */
  readonly feesAccruedInNumeraire: bigint;
}

/**
 * Aggregate output of {@link HistoricalReplaySimulation}.
 *
 *   - `totalFeesInNumeraire` — sum of per-interval fees.
 *   - `apr` — fees / principal scaled to a 1-year horizon at
 *     `APR_SCALE` (1e18 == 100% APR).
 *   - `meanIl` — average IL across the replay (excluding the entry
 *     snapshot itself). At `IL_SCALE`.
 *   - `minIl` / `maxIl` — extremes.
 *   - `finalIl` — IL at the *last* snapshot, when the LP would
 *     close. This is what the user "realizes" if they unwind.
 *   - `timeInRangeFraction` — fraction of *interval time* the
 *     position spent in-range, in [0, 1] at 1e18 precision.
 *   - `maxDrawdown` — the worst single-step IL dip below zero, at
 *     `IL_SCALE`. (Drawdown is intentionally absolute-value-free:
 *     we just track the most negative IL observed.)
 *   - `samples` — per-snapshot sample array for charting.
 */
export interface IHistoricalReplaySimulationOutput {
  readonly samples: readonly IHistoricalReplaySample[];

  readonly totalFeesInNumeraire: bigint;
  readonly apr: bigint;
  readonly meanIl: bigint;
  readonly minIl: bigint;
  readonly maxIl: bigint;
  readonly finalIl: bigint;
  readonly timeInRangeFraction: bigint;
  readonly maxDrawdown: bigint;

  /** Total seconds elapsed across the replay window. */
  readonly totalSeconds: bigint;

  /** Number of `Δt` intervals used in the simulation. */
  readonly nIntervals: number;

  /** Snapshot count (== samples.length). */
  readonly nSnapshots: number;
}

/**
 * Level-3 simulation: walk a {@link PoolHistory} snapshot-by-snapshot
 * and accumulate IL + fees + APR + time-in-range for a candidate
 * position.
 *
 * Pure: no IO. The history is supplied at construction time;
 * per-run inputs are the entry price, fee rate, principal, and
 * numeraire choice.
 *
 * Caveats:
 *
 *   - We treat every interval as in-range-or-out uniformly; no
 *     intra-interpolation. For sub-minute snapshots a future
 *     revision should sub-sample.
 *   - Fees are modeled as a *flat* per-second rate. In reality,
 *     fees depend on `liquidity`, volume, and competitor liquidity,
 *     but that's a Phase 9+ modeling task.
 *   - The "in-range" test is computed against the position's tick
 *     range, using the snapshot's `tick` field — no need to convert
 *     from price.
 */
export class HistoricalReplaySimulation
  implements ISimulation<IHistoricalReplaySimulationInput, IHistoricalReplaySimulationOutput>
{
  readonly id = 'historical-replay';

  /** Aggregate-scale constants re-exported for callers. */
  static readonly IL_SCALE = IL_SCALE;

  static readonly APR_SCALE = APR_SCALE;

  /** One in `IL_SCALE` precision (1e18 == 100%). */
  static readonly ONE = 10n ** 18n;

  /** Seconds in a calendar year. */
  static readonly SECONDS_PER_YEAR = SECONDS_PER_YEAR;

  /** History to replay (set at construction). */
  private readonly history: PoolHistory;

  constructor(options: IHistoricalReplaySimulationOptions) {
    if (!options.history) {
      throw new Error(
        'HistoricalReplaySimulation requires a PoolHistory',
      );
    }

    this.history = options.history;
  }

  /** Read-only access to the bound history (for tests / UI). */
  get boundHistory(): PoolHistory {
    return this.history;
  }

  run(
    input: IHistoricalReplaySimulationInput,
    _pool: Pool,
    position: Position,
  ): IHistoricalReplaySimulationOutput {
    const snapshots = this.history.toArray();

    if (snapshots.length === 0) {
      throw new Error(
        'HistoricalReplaySimulation requires at least one snapshot in history',
      );
    }

    if (input.principalInNumeraire <= 0n) {
      throw new Error(
        `HistoricalReplaySimulation requires positive principalInNumeraire, got ${input.principalInNumeraire}`,
      );
    }

    if (input.feeRatePerSecond < 0n) {
      throw new Error(
        `HistoricalReplaySimulation requires non-negative feeRatePerSecond, got ${input.feeRatePerSecond}`,
      );
    }

    const samples: IHistoricalReplaySample[] = [];

    // We always emit a sample for the first snapshot (entry).
    const first = snapshots[0]!;
    const entrySide = this.sideOf(first.tick, position);
    samples.push({
      snapshotIndex: 0,
      timestamp: first.timestamp,
      blockNumber: first.blockNumber,
      price: first.price.value,
      priceDecimals: first.price.decimals,
      side: entrySide,
      inRange: entrySide === 'inside',
      il: 0n,
      feesAccruedInNumeraire: 0n,
    });

    let totalFees = 0n;
    let totalIl = 0n;
    let minIl = 0n;
    let maxIl = 0n;
    let maxDrawdown = 0n;
    let totalSeconds = 0n;
    let timeInRangeSeconds = 0n;
    let ilCount = 0n;

    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1]!;
      const curr = snapshots[i]!;

      const dt = curr.timestamp - prev.timestamp;

      if (dt < 0n) {
        throw new Error(
          `HistoricalReplaySimulation: non-monotonic timestamps at i=${i} `
          + `(${prev.timestamp} -> ${curr.timestamp})`,
        );
      }

      const side = this.sideOf(curr.tick, position);
      const inRange = side === 'inside';
      const il = ilBetweenPrices(
        curr.price.value,
        curr.price.decimals,
        input.entryPrice.value,
        input.entryPrice.decimals,
        18, // outDecimals; IL_SCALE = 1e18 is the *value* of the scale, not its `decimals`.
      );

      // Fees (raw numeraire units):
      //   intervalFees = principal × feeRatePerSecond × dt / 1e18
      //
      // `feeRatePerSecond` is at 1e18 precision in units of
      // "fraction of principal per second", so we multiply by
      // `principal × dt` and divide by 1e18 to land in raw
      // numeraire units.
      let intervalFees = 0n;

      if (inRange && dt > 0n) {
        intervalFees =
          (input.principalInNumeraire * input.feeRatePerSecond * dt)
          / HistoricalReplaySimulation.ONE;
        totalFees += intervalFees;
      }

      totalSeconds += dt;

      if (inRange) {
        timeInRangeSeconds += dt;
      }

      // IL stats — exclude the entry snapshot (i=0) which has il=0
      // by construction.
      totalIl += il;
      ilCount += 1n;

      if (il < minIl) {
        minIl = il;
      }

      if (il > maxIl) {
        maxIl = il;
      }

      if (il < maxDrawdown) {
        maxDrawdown = il;
      }

      samples.push({
        snapshotIndex: i,
        timestamp: curr.timestamp,
        blockNumber: curr.blockNumber,
        price: curr.price.value,
        priceDecimals: curr.price.decimals,
        side,
        inRange,
        il,
        feesAccruedInNumeraire: intervalFees,
      });
    }

    // Aggregate metrics.
    const meanIl = ilCount > 0n ? totalIl / ilCount : 0n;

    const finalIl = samples.at(-1)?.il ?? 0n;

    const timeInRangeFraction = totalSeconds > 0n
      ? (timeInRangeSeconds * HistoricalReplaySimulation.ONE) / totalSeconds
      : 0n;

    // APR (1e18 == 100%):
    //
    //   apr_1e18 = (totalFees × spy) / (principal × totalSeconds) × 1e18
    //
    // Rationale: `totalFees / principal` is unitless at the
    // numeraire's scale; multiplying by `spy / totalSeconds` scales
    // to a 1-year horizon. Multiplying by `ONE` puts the result on
    // the 1e18 == 100% scale used by the rest of Core (and matches
    // the math in `apr.util.ts`).
    let apr = 0n;

    if (input.principalInNumeraire > 0n && totalSeconds > 0n) {
      const numerator = totalFees * HistoricalReplaySimulation.SECONDS_PER_YEAR * HistoricalReplaySimulation.ONE;
      const denominator = input.principalInNumeraire * totalSeconds;
      apr = numerator / denominator;
    }

    return {
      samples,
      totalFeesInNumeraire: totalFees,
      apr,
      meanIl,
      minIl,
      maxIl,
      finalIl,
      timeInRangeFraction,
      maxDrawdown,
      totalSeconds,
      nIntervals: snapshots.length - 1,
      nSnapshots: snapshots.length,
    };
  }

  /**
   * Classify a tick relative to a position's range. V3 semantics:
   * `tickLower` inclusive, `tickUpper` exclusive (the convention
   * used by V3's pool contract: a tick at the upper bound is no
   * longer earning fees). For domain modeling we use inclusive on
   * both ends — this matches the rest of Core's `positionSide` and
   * `TickRange.contains`.
   */
  private sideOf(
    tick: number,
    position: Position,
  ): 'below' | 'inside' | 'above' {
    if (tick < position.range.tickLower) {
      return 'below';
    }

    if (tick > position.range.tickUpper) {
      return 'above';
    }

    return 'inside';
  }
}
