// app/core/test/utils/groupSnapshotsByDay.test.ts
//
// Unit tests for the snapshot → daily-OHLC aggregation used by
// PriceChart. We don't mock anything — the helper is pure.

import { describe, it, expect } from 'vitest';

import {
  groupSnapshotsByDay,
  type IOhlcCandle,
} from '../../../utils/groupSnapshotsByDay';

const SECONDS_PER_DAY = 86_400;

/** UTC midnight at 2024-01-01 = 1704067200. */
const D1 = 1_704_067_200;
const D2 = D1 + SECONDS_PER_DAY;
const D3 = D1 + 2 * SECONDS_PER_DAY;

const snap = (
  timestamp: number,
  price: bigint,
  priceDecimals = 6,
) => ({
  blockNumber: BigInt(timestamp),
  timestamp: BigInt(timestamp),
  tick: 0,
  price,
  priceDecimals,
});

describe('groupSnapshotsByDay', () => {
  it('returns [] for empty input', () => {
    expect(groupSnapshotsByDay([])).toEqual([]);
  });

  it('produces a single candle with open=high=low=close for a one-snapshot-per-day series', () => {
    // One snapshot on each of 3 UTC days, all at different prices.
    // Day 1: 100  Day 2: 110  Day 3: 120 (priceDecimals=6 → bigint scale).
    const snaps = [
      snap(D1, 100_000_000n),   // 100
      snap(D2, 110_000_000n),   // 110
      snap(D3, 120_000_000n),   // 120
    ];
    const candles = groupSnapshotsByDay(snaps);
    expect(candles).toHaveLength(3);
    expect(candles[0]).toEqual<IOhlcCandle>({
      time: D1,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      decimals: 6,
    });
    expect(candles[1]!.close).toBe(110);
    expect(candles[2]!.close).toBe(120);
  });

  it('aggregates high/low/max/min within a single day bucket', () => {
    // 4 snapshots on day 1 with prices [100, 120, 80, 110] in
    // chronological order — high=120, low=80, open=100, close=110.
    const snaps = [
      snap(D1 + 100,    100_000_000n),  // open
      snap(D1 + 200,    120_000_000n),  // high
      snap(D1 + 300,     80_000_000n),  // low
      snap(D1 + 86_300, 110_000_000n),  // close (just before next midnight)
    ];
    const [candle] = groupSnapshotsByDay(snaps);
    expect(candle).toBeDefined();
    expect(candle!.time).toBe(D1);
    expect(candle!.open).toBe(100);
    expect(candle!.high).toBe(120);
    expect(candle!.low).toBe(80);
    expect(candle!.close).toBe(110);
  });

  it('buckets a snapshot exactly at UTC midnight into the LATER day (floor semantics)', () => {
    // `floor(ts/86400) * 86400` — a snapshot at exactly midnight
    // belongs to the *new* day, not the previous one.
    // D1 = 1_704_067_200 (UTC midnight of Jan 1).
    // A snapshot at D1 + 0 belongs to day D1.
    const snaps = [
      snap(D1 - 1,          50_000_000n),   // last second of Dec 31 → bucket D1 - SECONDS_PER_DAY
      snap(D1,              60_000_000n),   // first second of Jan 1 → bucket D1
      snap(D1 + SECONDS_PER_DAY, 70_000_000n), // Jan 2 → bucket D2
    ];
    const candles = groupSnapshotsByDay(snaps);
    expect(candles).toHaveLength(3);
    expect(candles[0]!.time).toBe(D1 - SECONDS_PER_DAY);
    expect(candles[0]!.open).toBe(50);
    expect(candles[1]!.time).toBe(D1);
    expect(candles[1]!.open).toBe(60);
    expect(candles[2]!.time).toBe(D2);
    expect(candles[2]!.open).toBe(70);
  });

  it('handles multiple snapshots in the same UTC day without inflating the candle count', () => {
    // 10 snapshots all on D1 — must collapse to ONE candle.
    const snaps = [];
    for (let i = 0; i < 10; i++) {
      snaps.push(snap(D1 + i * 100, BigInt(100 + i) * 1_000_000n));
    }
    const candles = groupSnapshotsByDay(snaps);
    expect(candles).toHaveLength(1);
    expect(candles[0]!.open).toBe(100);
    expect(candles[0]!.close).toBe(109);
    expect(candles[0]!.high).toBe(109);
    expect(candles[0]!.low).toBe(100);
  });

  it('preserves chronological order even when the input is out of order', () => {
    // 3 days, deliberately reversed in the input array. The output
    // candles must still be ascending in time, and the open of
    // each candle must be the chronologically FIRST snapshot of
    // that day (not the array-first).
    const snaps = [
      snap(D3, 120_000_000n),
      snap(D2, 110_000_000n),
      snap(D1, 100_000_000n),
      snap(D3 + 100, 121_000_000n),  // second snapshot of D3, later in time
    ];
    const candles = groupSnapshotsByDay(snaps);
    expect(candles.map((c) => c.time)).toEqual([D1, D2, D3]);
    // D3 has TWO snapshots: 120 then 121 → open=120, close=121.
    expect(candles[2]!.open).toBe(120);
    expect(candles[2]!.close).toBe(121);
    expect(candles[2]!.high).toBe(121);
    expect(candles[2]!.low).toBe(120);
  });

  it('handles priceDecimals ≠ 6 without precision loss', () => {
    // Use priceDecimals = 8 to make sure the bigint → number
    // conversion is still exact for non-default precisions.
    const snaps = [
      snap(D1,     123_456_780n, 8), // 1.2345678
      snap(D1 + 1, 123_456_789n, 8), // 1.23456789 — high
      snap(D1 + 2, 123_456_700n, 8), // 1.234567   — low
    ];
    const [candle] = groupSnapshotsByDay(snaps);
    expect(candle!.open).toBeCloseTo(1.2345678, 8);
    expect(candle!.high).toBeCloseTo(1.23456789, 8);
    expect(candle!.low).toBeCloseTo(1.234567, 8);
    expect(candle!.close).toBeCloseTo(1.234567, 8);
    expect(candle!.decimals).toBe(8);
  });

  it('handles negative prices (long-short inversions) symmetrically', () => {
    // Defensive: prices can in principle be negative (e.g. a
    // synthetic test that signs-flips). The bigint comparator
    // uses signed arithmetic so high/low must still be correct.
    const snaps = [
      snap(D1,    (-50_000_000n)),   // -50
      snap(D1+1,  (-20_000_000n)),   // -20 (the highest / least negative)
      snap(D1+2,  (-80_000_000n)),   // -80 (the lowest / most negative)
    ];
    const [candle] = groupSnapshotsByDay(snaps);
    expect(candle!.open).toBe(-50);
    expect(candle!.high).toBe(-20);  // least negative = highest
    expect(candle!.low).toBe(-80);   // most negative = lowest
    expect(candle!.close).toBe(-80);
  });

  it('does not mutate the input array', () => {
    // Defensive: the function must be pure wrt input. We re-sort
    // internally so we copy first.
    const snaps = [
      snap(D2, 110_000_000n),
      snap(D1, 100_000_000n),
    ];
    const before = [...snaps];
    groupSnapshotsByDay(snaps);
    expect(snaps).toEqual(before);
  });
});
