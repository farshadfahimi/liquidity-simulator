// app/core/domains/aggregation/ohlc_candle.value-object.ts

import type { TCandleTimeframe } from './candle_timeframe.type';

/**
 * One OHLC (open / high / low / close) candle. Immutable.
 *
 * The aggregator produces these directly from a sorted snapshot
 * stream. All four price fields are bigint at a fixed `priceDecimals`
 * — same scale convention as `IHistorySnapshotDTO` — so the UI
 * can convert to numbers without precision loss.
 *
 * - `openTimestamp` is the *bucket start* (always aligned to the
 *   timeframe boundary: `:00`, `:05`, `:15`, `:00` for hour,
 *   `00:00` for day, etc.). A snapshot at `12:03:30` aggregated
 *   into a `'5m'` bucket has `openTimestamp` at the epoch-second
 *   for `12:00:00`.
 * - `closeTimestamp` is the *bucket end* (exclusive). For a `'5m'`
 *   bucket starting at `12:00:00`, the close is at `12:05:00`.
 *   The convention matches every charting library and keeps
 *   "adjacent candles don't overlap" trivially true.
 * - `sampleCount` is how many raw snapshots landed in the
 *   bucket. A `'4h'` candle with `sampleCount = 1` is sparse;
 *   downstream consumers (SL/TP logic, density heatmaps) can
 *   use this to downgrade confidence.
 *
 * `priceDecimals` is the precision the four `*Price` values are
 * scaled to. The aggregator inherits it from the first snapshot
 * in the bucket; mixing decimals across snapshots is rejected
 * by the aggregator at build time so this value is always the
 * precision of every price field in this candle.
 *
 * `averagePrice` is the arithmetic mean of the raw snapshot
 * prices in the bucket, expressed at the same `priceDecimals`
 * scale as the four OHLC fields. The aggregator computes it
 * via bigint division (`priceSum / BigInt(sampleCount)`) which
 * truncates toward zero at the *last representable unit*
 * (1 / 10^priceDecimals) — NOT at the human-readable integer
 * level. So a bucket of [100, 120, 80, 110] at 18 decimals
 * sums to 410 * 1e18, which divided by 4n yields
 * 102_500_000_000_000_000_000n (i.e. 102.5 * 1e18), not
 * 102 * 1e18. For a single-snapshot bucket the value equals
 * the open/high/low/close prices exactly. A SL/TP detector
 * that wants "did price spend most of the bucket above the
 * entry price?" can compare `averagePrice` against the entry
 * directly, without the noise of high/low spikes. The mean is
 * always bounded by [lowPrice, highPrice] for any non-empty
 * bucket.
 */
export class OhlcCandle {
  readonly openTimestamp: bigint;

  readonly closeTimestamp: bigint;

  readonly timeframe: TCandleTimeframe;

  readonly openPrice: bigint;

  readonly highPrice: bigint;

  readonly lowPrice: bigint;

  readonly closePrice: bigint;

  readonly averagePrice: bigint;

  readonly priceDecimals: number;

  readonly sampleCount: number;

  constructor(
    openTimestamp: bigint,
    closeTimestamp: bigint,
    timeframe: TCandleTimeframe,
    openPrice: bigint,
    highPrice: bigint,
    lowPrice: bigint,
    closePrice: bigint,
    averagePrice: bigint,
    priceDecimals: number,
    sampleCount: number,
  ) {
    this.openTimestamp = openTimestamp;
    this.closeTimestamp = closeTimestamp;
    this.timeframe = timeframe;
    this.openPrice = openPrice;
    this.highPrice = highPrice;
    this.lowPrice = lowPrice;
    this.closePrice = closePrice;
    this.averagePrice = averagePrice;
    this.priceDecimals = priceDecimals;
    this.sampleCount = sampleCount;
  }
}
