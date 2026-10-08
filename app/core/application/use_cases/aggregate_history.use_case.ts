// app/core/application/use_cases/aggregate_history.use_case.ts

import {
  ALL_TIMEFRAMES,
  HistoryAggregator,
} from '../../domains/aggregation';
import type { TCandleTimeframe } from '../../domains/aggregation';
import { InvalidUseCaseInputError } from '../errors/invalid_input_error';
import type { IHistoryCandleDTO, IHistoryCandleMap } from '../dtos/candle.dto';

/**
 * Minimal snapshot shape the use case accepts. The full
 * `IHistorySnapshotDTO` satisfies this; raw
 * `PoolSnapshot.price.value` does too (after translation).
 *
 * Defined locally so the use case doesn't pull in the
 * `IHistorySnapshotDTO` type — the application layer is free
 * to aggregate any stream that carries a timestamp + a price,
 * including synthetic GBM paths, Monte Carlo outputs, or
 * the snapshot stream produced by an offline database loader
 * in a future phase.
 */
export interface IAggregatableSnapshotInput {
  readonly timestamp: bigint;
  readonly price: bigint;
  readonly priceDecimals: number;
}

/**
 * Input for {@link AggregateHistoryUseCase}.
 *
 * Three modes:
 *
 * - `timeframe: 'all'` (default) — produce all six standard
 *   timeframes in one call. The natural shape for a chart
 *   resolution selector.
 * - `timeframe: TCandleTimeframe` — produce one timeframe
 *   only. Returns a `Record` with the requested key populated
 *   and the rest empty.
 * - `timeframes: TCandleTimeframe[]` — produce a selective
 *   subset. The output map's unselected keys are `[]`.
 *
 * Snapshots must be sorted by `timestamp` ascending. The
 * aggregator does NOT re-sort — passing out-of-order snapshots
 * produces a malformed candle (open != first-in-time). The
 * `PoolHistory.toArray()` getter and the synthetic fallback
 * both honour this convention so any in-tree caller is safe.
 */
export interface IAggregateHistoryInput {
  readonly snapshots: readonly IAggregatableSnapshotInput[];

  /**
   * Aggregation mode. Default `'all'`. Mutually exclusive with
   * `timeframes`; when both are supplied, `timeframes` wins
   * (this is the more specific intent).
   */
  readonly timeframe?: TCandleTimeframe | 'all';

  /**
   * Selective subset of timeframes. Wins over `timeframe`
   * when both are supplied.
   */
  readonly timeframes?: readonly TCandleTimeframe[];
}

/**
 * Aggregate a snapshot stream into OHLC candles.
 *
 * Thin orchestration over {@link HistoryAggregator} — gives the
 * UI a single call site for "give me candles" without having
 * to instantiate the aggregator itself, and gives SL/TP
 * detection in the simulation layer the same code path.
 *
 * Pure: no I/O, no RPC, no SDK dependency. Safe to call from
 * anywhere a snapshot array is in scope.
 */
export class AggregateHistoryUseCase {
  readonly id = 'aggregate-history';

  private readonly aggregator: HistoryAggregator = new HistoryAggregator();

  execute(input: IAggregateHistoryInput): IHistoryCandleMap {
    if (!input.snapshots) {
      throw new InvalidUseCaseInputError(
        this.id,
        'snapshots',
        'array is required (use [] for an empty stream)',
      );
    }

    const selected = this.resolveSelection(input);

    const aggInput = input.snapshots.map((s) => ({
      timestamp: s.timestamp,
      price: s.price,
      priceDecimals: s.priceDecimals,
    }));

    const out = {} as Record<TCandleTimeframe, readonly IHistoryCandleDTO[]>;
    for (const tf of selected) {
      const candles = this.aggregator.aggregate(aggInput, tf);
      out[tf] = candles.map((c) => ({
        timeframe: c.timeframe,
        openTimestamp: c.openTimestamp,
        closeTimestamp: c.closeTimestamp,
        openPrice: c.openPrice,
        highPrice: c.highPrice,
        lowPrice: c.lowPrice,
        closePrice: c.closePrice,
        averagePrice: c.averagePrice,
        priceDecimals: c.priceDecimals,
        sampleCount: c.sampleCount,
      }));
    }

    // Fill unselected timeframes with empty arrays so the
    // output map's shape is always stable.
    for (const tf of ALL_TIMEFRAMES) {
      if (!(tf in out)) out[tf] = [];
    }

    return out as IHistoryCandleMap;
  }

  // -----------------------------------------------------------------
  // Internal — selection resolution
  // -----------------------------------------------------------------

  private resolveSelection(
    input: IAggregateHistoryInput,
  ): readonly TCandleTimeframe[] {
    if (input.timeframes && input.timeframes.length > 0) {
      // Defensive: drop duplicates and unknowns so a hostile
      // UI value can't smuggle in a typo.
      const seen = new Set<TCandleTimeframe>();
      const out: TCandleTimeframe[] = [];
      for (const tf of input.timeframes) {
        if (ALL_TIMEFRAMES.includes(tf) && !seen.has(tf)) {
          seen.add(tf);
          out.push(tf);
        }
      }
      return out;
    }
    if (input.timeframe && input.timeframe !== 'all') {
      if (!ALL_TIMEFRAMES.includes(input.timeframe)) {
        throw new InvalidUseCaseInputError(
          this.id,
          'timeframe',
          `unknown timeframe: ${input.timeframe}`,
        );
      }
      return [input.timeframe];
    }
    return ALL_TIMEFRAMES;
  }
}
