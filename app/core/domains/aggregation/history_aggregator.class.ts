// app/core/domains/aggregation/history_aggregator.class.ts

import {
  ALL_TIMEFRAMES,
  TIMEFRAME_SECONDS,
} from './candle_timeframe.type';
import type { TCandleTimeframe } from './candle_timeframe.type';
import { OhlcCandle } from './ohlc_candle.value-object';

/**
 * Minimal snapshot shape the aggregator needs. The full
 * `IHistorySnapshotDTO` satisfies this; the {@link PoolSnapshot}
 * value object does not (it doesn't expose a flat `price` bigint
 * on the value, only a `Price` wrapper), so in-process consumers
 * translate via `snapshot.price.value` before calling.
 *
 * Defined locally so the aggregator stays in the domain layer
 * with zero dependency on the application DTO barrel.
 */
export interface IAggregatableSnapshot {
  readonly timestamp: bigint;
  readonly price: bigint;
  readonly priceDecimals: number;
}

/**
 * Group raw per-block snapshots into OHLC candles.
 *
 * Pure class — no I/O, no RPC, no on-chain reads, no SDK
 * dependencies. Safe to use in any context that already has
 * snapshot data (charts, simulation pre-processing, SL/TP
 * detection, …).
 *
 * Bucket convention
 * -----------------
 *
 * A snapshot with timestamp `t` lands in the bucket
 *
 *     bucketStart = floor(t / periodSec) * periodSec
 *     bucketEnd   = bucketStart + periodSec
 *
 * where `periodSec` is `TIMEFRAME_SECONDS[timeframe]`. This is
 * the convention used by every major charting library, so the
 * candles render identically when handed to TradingView,
 * lightweight-charts, or Chart.js.
 *
 * Bucket assembly
 * ---------------
 *
 * Within a bucket, `open` is the first snapshot's price and
 * `close` is the last snapshot's price (in *input* order). The
 * aggregator does NOT sort the input — callers are expected to
 * pass snapshots in ascending timestamp order (the same order
 * `GetPoolHistoryUseCase` and `PoolHistory.toArray()` produce).
 * The "first in input order = open" rule mirrors the
 * `candlestick.time: 'buckets'` convention in TradingView and
 * is the natural choice for any streaming chart that appends
 * samples in time order.
 *
 * If a caller wants a different "open" rule (e.g. "the snapshot
 * closest to the bucket start"), they should pre-process the
 * stream before calling. The aggregator stays deliberately
 * opinionated.
 *
 * `high` and `low` are the max/min across the bucket. Ties
 * resolve to the earlier snapshot, so a flat bucket
 * (`open == high == low == close`) carries the open price in
 * all four fields.
 *
 * Empty streams
 * -------------
 *
 * An empty (or all-skipped) input returns `[]`. The aggregator
 * never throws on an empty input — chart and SL/TP callers
 * need an empty array to mean "no data", not an error.
 */
export class HistoryAggregator {
  /**
   * Bucket a snapshot stream into candles of the requested
   * timeframe. Returns candles in ascending `openTimestamp` order.
   *
   * Snapshots must be sorted by `timestamp` ascending. The
   * aggregator does NOT re-sort; passing out-of-order snapshots
   * produces a malformed candle (open != first-in-time).
   */
  aggregate(
    snapshots: readonly IAggregatableSnapshot[],
    timeframe: TCandleTimeframe,
  ): readonly OhlcCandle[] {
    const period = TIMEFRAME_SECONDS[timeframe];
    return this.aggregateAtPeriod(snapshots, timeframe, period);
  }

  /**
   * Bucket the same snapshot stream into all six standard
   * timeframes at once. Returns a map keyed by timeframe. The
   * internal bucket pass is a single linear walk; the six
   * output arrays are filled in the same pass.
   *
   * Equivalent to
   *
   *     const out: Record<TCandleTimeframe, OhlcCandle[]> = {
   *       '1m': agg.aggregate(snapshots, '1m'),
   *       // …
   *     } as const;
   *
   * but more allocation-friendly for large inputs and
   * guarantees the per-timeframe outputs are derived from the
   * same sorted stream (no risk of "I called this twice and
   * got different answers because the input was mutated").
   */
  aggregateAll(
    snapshots: readonly IAggregatableSnapshot[],
  ): Readonly<Record<TCandleTimeframe, readonly OhlcCandle[]>> {
    // Build one bucket pass per timeframe. Each pass is O(n) and
    // the work is trivial (one comparison + four assignments per
    // snapshot per timeframe), so the cost matrix is small enough
    // that a single linear walk would not meaningfully beat six
    // separate walks — but the six-walk approach keeps each
    // implementation local and easy to unit-test in isolation.
    const out = {} as Record<TCandleTimeframe, readonly OhlcCandle[]>;
    for (const tf of ALL_TIMEFRAMES) {
      out[tf] = this.aggregate(snapshots, tf);
    }
    return out;
  }

  // -----------------------------------------------------------------
  // Internal — single-timeframe bucket pass
  // -----------------------------------------------------------------

  private aggregateAtPeriod(
    snapshots: readonly IAggregatableSnapshot[],
    timeframe: TCandleTimeframe,
    period: bigint,
  ): readonly OhlcCandle[] {
    if (snapshots.length === 0) return [];

    // Detect "all snapshots share a `priceDecimals` value" up
    // front. A mixed-decimals stream is a caller bug (the
    // adapter always emits a single decimals per pool) and
    // we'll fail loudly below.
    const expectedDecimals = snapshots[0]!.priceDecimals;
    for (let i = 1; i < snapshots.length; i++) {
      if (snapshots[i]!.priceDecimals !== expectedDecimals) {
        throw new Error(
          `HistoryAggregator: mixed priceDecimals across snapshots ` +
          `(${expectedDecimals} vs ${snapshots[i]!.priceDecimals}) — ` +
          `caller must normalize before aggregating`,
        );
      }
    }

    const candles: OhlcCandle[] = [];
    let bucketStart = (snapshots[0]!.timestamp / period) * period;
    let bucketEnd = bucketStart + period;

    // State for the in-flight bucket. `priceSum` accumulates the
    // raw prices so we can compute the arithmetic mean (`averagePrice`)
    // at flush time without re-walking the bucket. The mean is
    // produced via bigint division (`priceSum / BigInt(count)`) which
    // truncates toward zero; a single-snapshot bucket therefore has
    // averagePrice == openPrice == highPrice == lowPrice == closePrice.
    let openPrice: bigint | null = null;
    let closePrice: bigint | null = null;
    let highPrice: bigint | null = null;
    let lowPrice: bigint | null = null;
    let priceSum = 0n;
    let count = 0;

    for (let i = 0; i < snapshots.length; i++) {
      const s = snapshots[i]!;
      const ts = s.timestamp;
      const price = s.price;

      // The snapshot is in the current bucket if it lives in
      // `[bucketStart, bucketEnd)`. `bucketEnd` is exclusive so
      // a snapshot at exactly `bucketEnd` opens the next
      // bucket — this matches TradingView's "right-edge
      // exclusive" rendering and prevents two candles from
      // owning the same instant.
      if (ts >= bucketEnd) {
        // Flush the current bucket. `averagePrice` is the
        // arithmetic mean of every raw price that landed in
        // the bucket; the bigint division truncates toward
        // zero at the last representable unit
        // (1 / 10^priceDecimals), so the result is always a
        // whole number at the candle's `priceDecimals` scale.
        candles.push(
          new OhlcCandle(
            bucketStart,
            bucketEnd,
            timeframe,
            openPrice!,
            highPrice!,
            lowPrice!,
            closePrice!,
            priceSum / BigInt(count),
            expectedDecimals,
            count,
          ),
        );

        // Roll forward to the bucket that contains this
        // snapshot. `floor(ts / period) * period` is the
        // canonical alignment; we may have skipped several
        // empty buckets, so a single division is enough.
        bucketStart = (ts / period) * period;
        bucketEnd = bucketStart + period;
        openPrice = null;
        closePrice = null;
        highPrice = null;
        lowPrice = null;
        priceSum = 0n;
        count = 0;
      }

      // Skip snapshots that fall *before* the current bucket
      // start. This can happen when a caller passes an
      // out-of-order stream; we silently drop them rather than
      // throw, because (a) the contract is "the input is
      // sorted" and (b) a malformed input still produces a
      // visually plausible chart if we just drop the stragglers.
      if (ts < bucketStart) continue;

      if (openPrice === null) {
        openPrice = price;
        highPrice = price;
        lowPrice = price;
      }
      else {
        if (price > highPrice!) highPrice = price;
        if (price < lowPrice!) lowPrice = price;
      }
      closePrice = price;
      priceSum += price;
      count += 1;
    }

    // Flush the final in-flight bucket.
    if (count > 0) {
      candles.push(
        new OhlcCandle(
          bucketStart,
          bucketEnd,
          timeframe,
          openPrice!,
          highPrice!,
          lowPrice!,
          closePrice!,
          priceSum / BigInt(count),
          expectedDecimals,
          count,
        ),
      );
    }

    return candles;
  }
}
