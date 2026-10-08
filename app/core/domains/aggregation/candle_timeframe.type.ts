// app/core/domains/aggregation/candle_timeframe.type.ts

/**
 * Standard chart timeframes used to bucket raw per-block snapshots
 * into OHLC candles.
 *
 * The list is intentionally fixed — these are the six timeframes
 * the UI exposes in the chart resolution selector. Adding a new
 * timeframe is a deliberate operation (it widens the per-candle
 * cost matrix and may require a new test fixture), so callers
 * don't get to pick arbitrary minute counts.
 *
 * - `'1m'`  — 1 minute
 * - `'5m'`  — 5 minutes
 * - `'15m'` — 15 minutes
 * - `'1h'`  — 1 hour
 * - `'4h'`  — 4 hours
 * - `'1d'`  — 1 day
 */
export type TCandleTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

/**
 * Every supported timeframe, in ascending order. Exposed so the
 * UI can render a stable dropdown without hard-coding the list
 * and so the aggregator's "all timeframes" routine can iterate
 * them in canonical order.
 */
export const ALL_TIMEFRAMES: readonly TCandleTimeframe[] = [
  '1m',
  '5m',
  '15m',
  '1h',
  '4h',
  '1d',
] as const;

/**
 * Period length of each timeframe, in seconds. Single source of
 * truth — both the domain aggregator and the application-layer
 * DTO helpers consume it.
 *
 * Note: these are calendar seconds, not block counts. The
 * aggregator buckets by `floor(timestamp / periodSec)`, so a
 * snapshot at `12:00:30` in a `'1m'` bucket lands in the
 * `12:00` candle; the same snapshot in a `'5m'` bucket lands in
 * the `12:00` candle. The choice of "0", "15", "30", "45"
 * minute-of-hour boundaries for the sub-hour timeframes matches
 * the floor-from-epoch convention used by every major charting
 * library (TradingView, lightweight-charts, Chart.js with
 * `time.unit: 'minute'`, etc.).
 */
export const TIMEFRAME_SECONDS: Readonly<Record<TCandleTimeframe, bigint>> = {
  '1m': 60n,
  '5m': 300n,
  '15m': 900n,
  '1h': 3_600n,
  '4h': 14_400n,
  '1d': 86_400n,
} as const;

/**
 * Type guard: is the given string a supported {@link TCandleTimeframe}?
 * Used by parsers that accept user-supplied timeframe strings
 * (e.g. the chart's resolution dropdown) and need to reject
 * unknown values before reaching the aggregator.
 */
export function isCandleTimeframe(value: string): value is TCandleTimeframe {
  return value in TIMEFRAME_SECONDS;
}
