// app/core/test/domains/aggregation/aggregation.test.ts
//
// Unit tests for the pure snapshot → OHLC candle aggregator. No
// mocks, no I/O, no RPC. Verifies:
//
//   1. Empty input → empty output (no throw).
//   2. Single-snapshot-per-bucket → O=H=L=C.
//   3. Multi-snapshot buckets → correct O/H/L/C, sampleCount.
//   4. Bucket boundaries align to the timeframe (floor semantics).
//   5. All six timeframes produce well-formed candles.
//   6. Mixed-decimals input is rejected.
//   7. Out-of-order snapshots are dropped (no throw).
//   8. aggregateAll returns all six timeframes in canonical order.

import { describe, it, expect } from 'vitest';

import {
  ALL_TIMEFRAMES,
  HistoryAggregator,
  OhlcCandle,
  TIMEFRAME_SECONDS,
  isCandleTimeframe,
  createHistoryAggregator,
} from '@core/domains/aggregation';

import { PRICE_DECIMALS } from '../../test-constants';

const PD = PRICE_DECIMALS;
const TF = TIMEFRAME_SECONDS;

/**
 * Anchor timestamp that sits exactly on the 1d / 4h / 1h / 15m /
 * 5m / 1m boundaries. Every test that depends on bucket
 * alignment uses this so the bucket-start matches the test's
 * expectation without surprises from bigint floor division.
 */
const T0 = 1_728_000_000; // = 2024-05-21 00:00:00 UTC

/** Build an aggregatable snapshot at a given unix-second timestamp. */
const snap = (
  timestampSeconds: number,
  priceHuman: number,
  priceDecimals: number = PD,
) => ({
  timestamp: BigInt(timestampSeconds),
  price: BigInt(Math.round(priceHuman * 10 ** priceDecimals)),
  priceDecimals,
});

describe('OhlcCandle value object', () => {
  it('exposes the four OHLC fields, average, and bucket boundaries verbatim', () => {
    const c = new OhlcCandle(
      1000n, // openTimestamp
      1300n, // closeTimestamp (300s = 5m bucket)
      '5m',
      100n,  // open
      200n,  // high
      50n,   // low
      150n,  // close
      125n,  // average
      18,
      7,
    );
    expect(c.openTimestamp).toBe(1000n);
    expect(c.closeTimestamp).toBe(1300n);
    expect(c.timeframe).toBe('5m');
    expect(c.openPrice).toBe(100n);
    expect(c.highPrice).toBe(200n);
    expect(c.lowPrice).toBe(50n);
    expect(c.closePrice).toBe(150n);
    expect(c.averagePrice).toBe(125n);
    expect(c.priceDecimals).toBe(18);
    expect(c.sampleCount).toBe(7);
  });
});

describe('createHistoryAggregator', () => {
  it('returns a HistoryAggregator instance', () => {
    const agg = createHistoryAggregator();
    expect(agg).toBeInstanceOf(HistoryAggregator);
  });

  it('factory output is stateless and safe to share', () => {
    // Two calls must produce functionally identical aggregators;
    // a shared instance must not leak state between callers.
    const a = createHistoryAggregator();
    const b = createHistoryAggregator();
    const input = [snap(0, 100), snap(60, 110), snap(120, 120)];
    const ra = a.aggregate(input, '1m');
    const rb = b.aggregate(input, '1m');
    expect(ra).toEqual(rb);
  });
});

describe('HistoryAggregator.aggregate (single timeframe)', () => {
  it('returns [] for empty input', () => {
    const agg = new HistoryAggregator();
    expect(agg.aggregate([], '1m')).toEqual([]);
    expect(agg.aggregate([], '1d')).toEqual([]);
  });

  it('single snapshot per bucket: O=H=L=C=average, sampleCount=1', () => {
    // Three minutes, one snapshot per minute → three 1m candles.
    // A single-snapshot bucket has no spread, so the mean
    // equals every other price field by definition.
    const t0 = T0;
    const agg = new HistoryAggregator();
    const candles = agg.aggregate(
      [snap(t0, 100), snap(t0 + 60, 110), snap(t0 + 120, 120)],
      '1m',
    );
    expect(candles).toHaveLength(3);
    for (const c of candles) {
      expect(c.openPrice).toBe(c.highPrice);
      expect(c.openPrice).toBe(c.lowPrice);
      expect(c.openPrice).toBe(c.closePrice);
      expect(c.averagePrice).toBe(c.openPrice);
      expect(c.sampleCount).toBe(1);
    }
    expect(candles[0]!.openTimestamp).toBe(BigInt(t0));
    expect(candles[1]!.openTimestamp).toBe(BigInt(t0 + 60));
    expect(candles[2]!.openTimestamp).toBe(BigInt(t0 + 120));
  });

  it('multiple snapshots per bucket: correct O/H/L/C/average and sampleCount', () => {
    // 4 snapshots inside the same 5m bucket (one 5m window is 300s).
    // Sum of human-readable prices: 100 + 120 + 80 + 110 = 410.
    // At 1e18 scale: 410 * 1e18 / 4n = 102.5 * 1e18 (the
    // bigint division keeps the fractional digit because the
    // dividend itself is at the 1e18 scale).
    const t0 = T0; // bucket start (T0 is on a 5m boundary)
    const agg = new HistoryAggregator();
    const candles = agg.aggregate(
      [
        snap(t0, 100),       // open
        snap(t0 + 60, 120),  // high
        snap(t0 + 120, 80),  // low
        snap(t0 + 180, 110), // close
      ],
      '5m',
    );
    expect(candles).toHaveLength(1);
    const c = candles[0]!;
    expect(c.openTimestamp).toBe(BigInt(t0));
    expect(c.closeTimestamp).toBe(BigInt(t0 + 300));
    expect(c.openPrice).toBe(100n * 10n ** BigInt(PD));
    expect(c.highPrice).toBe(120n * 10n ** BigInt(PD));
    expect(c.lowPrice).toBe(80n * 10n ** BigInt(PD));
    expect(c.closePrice).toBe(110n * 10n ** BigInt(PD));
    // 410 * 1e18 / 4n = 102_500_000_000_000_000_000n. (Not 102
    // * 1e18 — the truncation is at the last representable
    // 1e-18 unit, not at the human-readable integer.)
    expect(c.averagePrice).toBe(102_500_000_000_000_000_000n);
    expect(c.sampleCount).toBe(4);
  });

  it('averagePrice truncates toward zero on non-divisible sums', () => {
    // 3 prices in the same 1m bucket (every snapshot must
    // land in [t0, t0+60) for the right-edge-exclusive rule).
    // Sum: 1 + 2 + 2 = 5 (in human units). At 1e18 scale:
    // 5 * 1e18 / 3n = 1_666_666_666_666_666_666n. The
    // remainder 0.333... * 1e18 = 333_333_333_333_333_333
    // is dropped by bigint division.
    const t0 = T0;
    const agg = new HistoryAggregator();
    const candles = agg.aggregate(
      [
        snap(t0, 1),
        snap(t0 + 15, 2),
        snap(t0 + 30, 2),
      ],
      '1m',
    );
    expect(candles).toHaveLength(1);
    expect(candles[0]!.averagePrice).toBe(1_666_666_666_666_666_666n);
    expect(candles[0]!.sampleCount).toBe(3);
  });

  it('averagePrice is bounded by [lowPrice, highPrice] in every candle', () => {
    // Sanity invariant: the mean of any set of values is
    // always in the [min, max] range. If this ever fails the
    // aggregator is producing a non-mean and downstream
    // SL/TP logic is now unsafe.
    const t0 = T0;
    const agg = new HistoryAggregator();
    // 10 minutes of jittery prices, 1 snapshot per minute.
    const jitter = [105, 95, 110, 100, 108, 92, 103, 99, 106, 101];
    const snaps = jitter.map((p, i) => snap(t0 + i * 60, p));
    const candles = agg.aggregate(snaps, '5m');
    expect(candles).toHaveLength(2);
    for (const c of candles) {
      expect(c.averagePrice).toBeGreaterThanOrEqual(c.lowPrice);
      expect(c.averagePrice).toBeLessThanOrEqual(c.highPrice);
    }
    // First 5-minute bucket (t0..t0+300, snapshots 0..4):
    // mean of [105, 95, 110, 100, 108] → 518/5 = 103.6
    // (truncated to 103_600_000_000_000_000_000n at 1e18).
    expect(candles[0]!.averagePrice).toBe(103_600_000_000_000_000_000n);
    // Second 5-minute bucket (t0+300..t0+600, snapshots 5..9):
    // mean of [92, 103, 99, 106, 101] → 501/5 = 100.2
    // (truncated to 100_200_000_000_000_000_000n at 1e18).
    expect(candles[1]!.averagePrice).toBe(100_200_000_000_000_000_000n);
  });

  it('bucket boundaries are aligned to floor(ts / period) * period', () => {
    // A snapshot at ts=12:03:30 belongs to the 5m bucket
    // that starts at 12:00:00, NOT at 12:03:00.
    const t0 = 1_728_000_000; // a 1d / 4h / 1h / 15m / 5m / 1m boundary
    const t_mid = t0 + 210;   // 3:30 into the bucket
    const agg = new HistoryAggregator();
    const candles = agg.aggregate([snap(t_mid, 100)], '5m');
    expect(candles).toHaveLength(1);
    // Bucket must align to t0, not t_mid.
    expect(candles[0]!.openTimestamp).toBe(BigInt(t0));
    expect(candles[0]!.closeTimestamp).toBe(BigInt(t0 + 300));
  });

  it('a snapshot at exactly bucketEnd opens the next bucket (right-edge exclusive)', () => {
    // t0 + 300 is the EXCLUSIVE end of the 5m bucket starting at
    // t0. A snapshot at exactly t0 + 300 belongs to the NEXT
    // bucket (which starts at t0 + 300).
    const t0 = 1_728_000_000; // 5m boundary
    const agg = new HistoryAggregator();
    const candles = agg.aggregate(
      [snap(t0 + 300, 200)],
      '5m',
    );
    expect(candles).toHaveLength(1);
    expect(candles[0]!.openTimestamp).toBe(BigInt(t0 + 300));
    expect(candles[0]!.closeTimestamp).toBe(BigInt(t0 + 600));
  });

  it('produces well-formed candles for every supported timeframe', () => {
    // 4 hours of 1-second snapshots (14_400 snapshots total).
    // The first timestamp is on a 1m / 5m / 15m / 1h / 4h / 1d
    // boundary so every timeframe gets a whole number of candles.
    const t0 = 1_728_000_000;
    const period = 1; // 1-second tick
    const totalSeconds = 4 * 60 * 60; // 4h
    const snaps = Array.from({ length: totalSeconds / period }, (_, i) =>
      snap(t0 + i * period, 100 + (i % 50)),
    );

    const agg = new HistoryAggregator();

    // 1-second ticks over 4h → 240 1m candles (one per minute).
    expect(agg.aggregate(snaps, '1m')).toHaveLength(240);

    // 240 / 5 = 48 5m candles.
    expect(agg.aggregate(snaps, '5m')).toHaveLength(48);

    // 240 / 15 = 16 15m candles.
    expect(agg.aggregate(snaps, '15m')).toHaveLength(16);

    // 240 / 60 = 4 1h candles.
    expect(agg.aggregate(snaps, '1h')).toHaveLength(4);

    // 240 / 240 = 1 4h candle.
    expect(agg.aggregate(snaps, '4h')).toHaveLength(1);

    // 4h window → 1 1d candle (the rest of the day is empty).
    const dCandles = agg.aggregate(snaps, '1d');
    expect(dCandles).toHaveLength(1);
    expect(dCandles[0]!.closeTimestamp - dCandles[0]!.openTimestamp).toBe(TF['1d']);
  });

  it('preserves the priceDecimals field on the output candle', () => {
    const t0 = T0;
    const agg = new HistoryAggregator();
    const candles = agg.aggregate(
      [snap(t0, 1.5, 8), snap(t0 + 30, 1.7, 8)],
      '1m',
    );
    expect(candles).toHaveLength(1);
    expect(candles[0]!.priceDecimals).toBe(8);
  });

  it('throws when priceDecimals is inconsistent across the stream', () => {
    // Mixing decimals in one stream is a caller bug. The
    // aggregator surfaces it loudly so it can be fixed at the
    // adapter boundary, not silently producing garbage candles.
    const t0 = T0;
    const agg = new HistoryAggregator();
    expect(() =>
      agg.aggregate([snap(t0, 1, 6), snap(t0 + 60, 1, 8)], '1m'),
    ).toThrow(/mixed priceDecimals/);
  });

  it('out-of-order snapshots are dropped (no throw, no malformed candle)', () => {
    // The second snapshot has ts < bucketEnd of the first
    // bucket's *current* state. Because the first snapshot
    // already opened a bucket at t0+300, the second snapshot
    // (ts=t0) is BEFORE that bucket's start and is dropped
    // silently — the candle's open stays the chronological
    // first.
    const t0 = T0;
    const agg = new HistoryAggregator();
    const candles = agg.aggregate(
      [snap(t0 + 300, 200), snap(t0, 100)],
      '5m',
    );
    expect(candles).toHaveLength(1);
    expect(candles[0]!.openTimestamp).toBe(BigInt(t0 + 300));
    expect(candles[0]!.openPrice).toBe(200n * 10n ** BigInt(PD));
  });
});

describe('HistoryAggregator.aggregateAll', () => {
  it('returns a map with all six timeframes populated', () => {
    // 14,400 snapshots at 60s intervals = 10 days of 1-minute
    // data. Starts on a 1d boundary so every timeframe has a
    // whole number of buckets.
    const t0 = 1_728_000_000; // 1d boundary (also 4h/1h/15m/5m/1m)
    const snaps = Array.from({ length: 60 * 60 * 24 * 10 / 60 }, (_, i) =>
      snap(t0 + i * 60, 100 + (i % 50)),
    );
    expect(snaps).toHaveLength(14_400);
    const agg = new HistoryAggregator();
    const all = agg.aggregateAll(snaps);
    for (const tf of ALL_TIMEFRAMES) {
      expect(all[tf]).toBeDefined();
      expect(all[tf]!.length).toBeGreaterThan(0);
    }
    // 14,400 / 1m = 14,400  1m candles.
    // 14,400 / 5m =  2,880  5m candles.
    // 14,400 / 15m =   960  15m candles.
    // 14,400 / 1h  =   240  1h candles.
    // 14,400 / 4h  =    60  4h candles.
    // 10d         =    10  1d candles.
    expect(all['1m']).toHaveLength(14_400);
    expect(all['5m']).toHaveLength(2_880);
    expect(all['15m']).toHaveLength(960);
    expect(all['1h']).toHaveLength(240);
    expect(all['4h']).toHaveLength(60);
    expect(all['1d']).toHaveLength(10);
  });

  it('returns all-empty arrays for empty input (shape preserved)', () => {
    const agg = new HistoryAggregator();
    const all = agg.aggregateAll([]);
    for (const tf of ALL_TIMEFRAMES) {
      expect(all[tf]).toEqual([]);
    }
  });

  it('output keys are the canonical TCandleTimeframe union', () => {
    const agg = new HistoryAggregator();
    const all = agg.aggregateAll([snap(0, 100)]);
    expect(Object.keys(all).sort()).toEqual([...ALL_TIMEFRAMES].sort());
  });
});

describe('isCandleTimeframe type guard', () => {
  it('accepts every member of the union', () => {
    for (const tf of ALL_TIMEFRAMES) {
      expect(isCandleTimeframe(tf)).toBe(true);
    }
  });

  it('rejects unknown strings', () => {
    expect(isCandleTimeframe('2m')).toBe(false);
    expect(isCandleTimeframe('1s')).toBe(false);
    expect(isCandleTimeframe('')).toBe(false);
    expect(isCandleTimeframe('1M')).toBe(false); // case-sensitive
  });
});

describe('integration with PoolHistory snapshot shape', () => {
  it('accepts snapshots that mirror IHistorySnapshotDTO fields', () => {
    // The use case layer builds IAggregatableSnapshot by
    // mapping `IHistorySnapshotDTO`. This test guards the
    // shape contract: a snapshot that has timestamp + price +
    // priceDecimals (and any other fields) aggregates correctly.
    const t0 = T0;
    const snapshotLike = [
      {
        blockNumber: 18_000_000n,
        timestamp: BigInt(t0),
        tick: 200_000,
        price: BigInt(100 * 10 ** PD),
        priceDecimals: PD,
      },
      {
        blockNumber: 18_000_001n,
        timestamp: BigInt(t0 + 60),
        tick: 200_010,
        price: BigInt(110 * 10 ** PD),
        priceDecimals: PD,
      },
    ];
    const agg = new HistoryAggregator();
    const candles = agg.aggregate(snapshotLike, '1m');
    expect(candles).toHaveLength(2);
    expect(candles[0]!.openPrice).toBe(BigInt(100 * 10 ** PD));
    expect(candles[1]!.closePrice).toBe(BigInt(110 * 10 ** PD));
  });
});
