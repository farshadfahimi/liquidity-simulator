// app/utils/groupSnapshotsByDay.ts
//
// Group raw on-chain history snapshots by **UTC calendar day** and
// collapse each day to a single OHLC candle.
//
// Why this exists:
//   - `IHistorySnapshotDTO` carries exactly one `price` per snapshot
//     (the close at the snapshot's block). The chart can't plot
//     true OHLC without additional RPC round-trips.
//   - But the chart USERS expect a daily chart, not a per-block
//     chart — 30 block-spaced points that don't line up to
//     midnights look noisy and unhelpful.
//   - The compromise: down-sample on the client by bucketing the
//     snapshots we already have into UTC days and taking
//       open   = first snapshot of the day (by timestamp)
//       high   = max(price) of the day's snapshots
//       low    = min(price) of the day's snapshots
//       close  = last snapshot of the day
//     Each UTC day becomes a single candlestick. Within-day
//     intraday wicks collapse to a doji, which is honest — the day
//     only had one source price — but the *cross-day* movement is
//     faithfully preserved because high/low are computed across
//     the whole day's snapshots.
//
// Pure: no chart deps, no I/O, deterministic. Safe to import from
// the SFC and from Vitest.
//
// Bucket semantics:
//   - Buckets are keyed on `floor(timestamp / 86400) * 86400`
//     (unix seconds at UTC midnight). This is `block.timestamp`
//     semantics (always UTC), so wall-clock midnight UTC lines
//     up with the bucket boundary for any chain.
//   - Snapshots are sorted chronologically before bucketing so
//     the first-of-day is the chronological first, not the array
//     insertion order. (Callers may pass already-sorted arrays;
//     we re-sort defensively.)
//   - Days with zero snapshots are skipped.

import type { IHistorySnapshotDTO } from '@core/application/dtos';

/**
 * One collapsed daily candle.
 *
 * - `time` is the unix-seconds timestamp of the UTC midnight that
 *   starts the bucket. Matches the lightweight-charts v5
 *   `UTCTimestamp` shape.
 * - `open/high/low/close` are already converted to JS numbers
 *   via `exactPriceToNumber(snapshot.price, snapshot.priceDecimals)`
 *   so consumers don't have to thread `priceDecimals` through.
 *   The conversion is exact at priceDecimals ≤ 18 (well above
 *   the 6 used in the demo); see the helper's own tests.
 *
 * `decimals` is kept on the shape so any future caller that needs
 * the raw bigint can reconstruct it without re-reading the DTO.
 */
export interface IOhlcCandle {
  /** UTC midnight of the bucket, in unix seconds. */
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  /** Source `priceDecimals` — pass-through for downstream use. */
  readonly decimals: number;
}

/** Seconds in one UTC day. */
const SECONDS_PER_DAY = 86_400;

/** Pure bigint → number conversion, exact for priceDecimals ≤ 18. */
function bigintPriceToNumber(price: bigint, decimals: number): number {
  if (price === 0n) return 0;
  const negative = price < 0n;
  const abs = negative ? -price : price;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  // Whole part is always small (a token price is rarely above 2^53).
  const wholeNum = Number(whole);
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  if (fracStr.length === 0) return negative ? -wholeNum : wholeNum;
  const fracNum = Number(`0.${fracStr}`);
  return negative ? -(wholeNum + fracNum) : wholeNum + fracNum;
}

function bucketKey(tsSeconds: bigint): number {
  // Floor-divide on a bigint to avoid loss for very large unix
  // timestamps (year 275760+), then multiply by day seconds.
  // Number arithmetic is safe here because day-counts since the
  // epoch are well below 2^53 until the year 287396.
  const day = Number(tsSeconds / BigInt(SECONDS_PER_DAY));
  return day * SECONDS_PER_DAY;
}

/**
 * Group snapshots into daily OHLC candles.
 *
 * Notes:
 *  - Re-sorts the input by timestamp ascending so first-of-day is
 *    the chronological first snapshot, not the array first.
 *  - If a bucket has only one snapshot, all four OHLC values are
 *    equal (doji within that day). This is the honest collapse
 *    of a single-price-per-day dataset.
 *  - Empty input → `[]`.
 *  - If the input is already sorted, the defensive sort is a
 *    no-op; we keep it so the function is idempotent.
 */
export function groupSnapshotsByDay(
  snapshots: readonly IHistorySnapshotDTO[],
): IOhlcCandle[] {
  if (snapshots.length === 0) return [];

  // Defensive copy + sort by timestamp ascending. We do this
  // BEFORE bucketing so the first-of-day in the input order
  // doesn't leak into the candle.
  const sorted = [...snapshots].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );

  // Bucket key → array of snapshots in that day (insertion order
  // matches chronological order because we sorted above).
  const buckets = new Map<number, IHistorySnapshotDTO[]>();
  for (const s of sorted) {
    const key = bucketKey(s.timestamp);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(s);
  }

  // Convert buckets → candles in chronological order.
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const candles: IOhlcCandle[] = [];
  for (const key of keys) {
    const bucket = buckets.get(key)!;
    if (bucket.length === 0) continue;

    const decimals = bucket[0]!.priceDecimals;
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;

    let highBig = first.price;
    let lowBig = first.price;
    for (const s of bucket) {
      if (s.price > highBig) highBig = s.price;
      if (s.price < lowBig) lowBig = s.price;
    }

    candles.push({
      time: key,
      open: bigintPriceToNumber(first.price, decimals),
      high: bigintPriceToNumber(highBig, decimals),
      low: bigintPriceToNumber(lowBig, decimals),
      close: bigintPriceToNumber(last.price, decimals),
      decimals,
    });
  }

  return candles;
}
