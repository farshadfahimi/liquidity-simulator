// app/core/application/dtos/candle.dto.ts

import type { TCandleTimeframe } from '../../domains/aggregation';

/**
 * Wire/UI representation of one OHLC candle. Mirrors the
 * {@link OhlcCandle} domain value object but with plain bigint
 * fields and no methods — the UI never needs to call anything
 * on a candle, it just renders the values.
 *
 * Same scale conventions as the domain object:
 * - `openTimestamp` is the *bucket start* (inclusive).
 * - `closeTimestamp` is the *bucket end* (exclusive).
 * - The four `*Price` values are at `priceDecimals` precision
 *   (1e18 == 1.0 for the default 18-dec output).
 * - `sampleCount` is the number of raw snapshots in the bucket.
 *   A `'4h'` candle with `sampleCount = 1` is sparse and a
 *   chart or SL/TP tool may want to flag it.
 * - `averagePrice` is the arithmetic mean of the raw snapshot
 *   prices in the bucket, at the same `priceDecimals` scale as
 *   the OHLC fields. The mean is computed via bigint division
 *   (`priceSum / BigInt(sampleCount)`) which truncates toward
 *   zero at the *last representable unit* (1 / 10^priceDecimals)
 *   — NOT at the human-readable integer level. So [100, 120,
 *   80, 110] at 18 decimals yields 102.5 * 1e18, not 102 * 1e18.
 *   A single-snapshot candle has
 *   `averagePrice == openPrice == highPrice == lowPrice == closePrice`.
 *   SL/TP detection and analytics that want "did price spend
 *   most of the bucket above entry?" can compare `averagePrice`
 *   against the entry directly, without high/low spike noise.
 *   The mean is always bounded by [lowPrice, highPrice].
 */
export interface IHistoryCandleDTO {
  readonly timeframe: TCandleTimeframe;

  readonly openTimestamp: bigint;

  readonly closeTimestamp: bigint;

  readonly openPrice: bigint;

  readonly highPrice: bigint;

  readonly lowPrice: bigint;

  readonly closePrice: bigint;

  readonly averagePrice: bigint;

  readonly priceDecimals: number;

  readonly sampleCount: number;
}

/**
 * All six standard timeframes at once, keyed by timeframe.
 * Pre-computed at the use case so the UI doesn't have to call
 * the aggregator six times for a single chart load.
 */
export type IHistoryCandleMap = Readonly<
  Record<TCandleTimeframe, readonly IHistoryCandleDTO[]>
>;
