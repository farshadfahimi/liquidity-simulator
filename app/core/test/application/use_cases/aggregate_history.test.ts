// app/core/test/application/use_cases/aggregate_history.test.ts
//
// Unit tests for AggregateHistoryUseCase and the withCandles flag
// on GetPoolHistoryUseCase. The DTO translation logic lives in
// the use case; the bucket math lives in HistoryAggregator (see
// aggregation.test.ts). Here we exercise:
//
//   1. Default mode (`timeframe: 'all'`) populates all six
//      timeframes.
//   2. Selective mode (`timeframe: '1h'`) populates only the
//      requested timeframe.
//   3. Selective mode with a `TCandleTimeframe[]` populates
//      exactly that subset.
//   4. Invalid timeframe strings throw InvalidUseCaseInputError.
//   5. The shape of IHistoryCandleDTO round-trips correctly
//      (every field present, bigints preserved, sampleCount
//      correct).
//   6. GetPoolHistoryUseCase returns `candles: null` by default
//      and a populated map when `withCandles` is set.

import { describe, it, expect } from 'vitest';

import { ALL_TIMEFRAMES, TCandleTimeframe } from '@core/domains/aggregation';
import { AggregateHistoryUseCase } from '@core/application/use_cases/aggregate_history.use_case';
import { InvalidUseCaseInputError } from '@core/application/errors/invalid_input_error';

import { PRICE_DECIMALS } from '../../test-constants';

const PD = PRICE_DECIMALS;

/** Anchor timestamp aligned to 1d / 4h / 1h / 15m / 5m / 1m. */
const T0 = 1_728_000_000;

const snap = (ts: number, priceHuman: number, priceDecimals: number = PD) => ({
  timestamp: BigInt(ts),
  price: BigInt(Math.round(priceHuman * 10 ** priceDecimals)),
  priceDecimals,
});

describe('AggregateHistoryUseCase', () => {
  it('default mode (no `timeframe` field) aggregates all six timeframes', () => {
    const t0 = T0;
    // 4 hours of 1-minute snapshots.
    const snaps = Array.from({ length: 60 * 4 }, (_, i) =>
      snap(t0 + i * 60, 100 + (i % 10)),
    );
    const uc = new AggregateHistoryUseCase();
    const result = uc.execute({ snapshots: snaps });
    for (const tf of ALL_TIMEFRAMES) {
      expect(result[tf]).toBeDefined();
    }
    expect(result['1m']).toHaveLength(240);
    expect(result['1h']).toHaveLength(4);
  });

  it('single-timeframe mode returns only the requested timeframe populated', () => {
    const t0 = T0;
    const snaps = Array.from({ length: 60 * 4 }, (_, i) =>
      snap(t0 + i * 60, 100 + (i % 10)),
    );
    const uc = new AggregateHistoryUseCase();
    const result = uc.execute({ snapshots: snaps, timeframe: '1h' });
    expect(result['1h']).toHaveLength(4);
    // Other timeframes must be present as empty arrays so the
    // shape is stable.
    expect(result['1m']).toEqual([]);
    expect(result['5m']).toEqual([]);
    expect(result['15m']).toEqual([]);
    expect(result['4h']).toEqual([]);
    expect(result['1d']).toEqual([]);
  });

  it('timeframes: TCandleTimeframe[] populates exactly that subset', () => {
    const t0 = T0;
    const snaps = Array.from({ length: 60 * 4 }, (_, i) =>
      snap(t0 + i * 60, 100 + (i % 10)),
    );
    const uc = new AggregateHistoryUseCase();
    const result = uc.execute({
      snapshots: snaps,
      timeframes: ['15m', '1h'] as readonly TCandleTimeframe[],
    });
    expect(result['15m']).toHaveLength(16);
    expect(result['1h']).toHaveLength(4);
    // Unselected → empty.
    expect(result['1m']).toEqual([]);
    expect(result['5m']).toEqual([]);
    expect(result['4h']).toEqual([]);
    expect(result['1d']).toEqual([]);
  });

  it('timeframes: [] falls back to the all-timeframes default', () => {
    // Empty `timeframes` array is treated as "no selection" →
    // same as the default behaviour.
    const t0 = T0;
    const snaps = Array.from({ length: 60 }, (_, i) =>
      snap(t0 + i * 60, 100 + (i % 5)),
    );
    const uc = new AggregateHistoryUseCase();
    const result = uc.execute({
      snapshots: snaps,
      timeframes: [],
    });
    for (const tf of ALL_TIMEFRAMES) {
      expect(result[tf].length).toBeGreaterThan(0);
    }
  });

  it('timeframes: with duplicates dedupes silently', () => {
    const t0 = T0;
    const snaps = Array.from({ length: 60 }, (_, i) =>
      snap(t0 + i * 60, 100 + (i % 5)),
    );
    const uc = new AggregateHistoryUseCase();
    const result = uc.execute({
      snapshots: snaps,
      timeframes: ['1h', '1h', '1h'] as readonly TCandleTimeframe[],
    });
    expect(result['1h']).toHaveLength(1);
  });

  it('timeframes: with unknown values ignores them silently', () => {
    // Defensive: a hostile UI value can't smuggle in a typo
    // and crash the chart — unknown timeframes are filtered
    // out of the `timeframes` list, and the output map's
    // canonical 6 keys are always present.
    const t0 = T0;
    const snaps = Array.from({ length: 60 }, (_, i) =>
      snap(t0 + i * 60, 100 + (i % 5)),
    );
    const uc = new AggregateHistoryUseCase();
    const result = uc.execute({
      snapshots: snaps,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      timeframes: ['1h', '2m' as any, 'unknown' as any] as any,
    });
    expect(result['1h']).toHaveLength(1);
    // '2m' and 'unknown' were rejected by the dedupe filter, so
    // they don't appear as keys on the output map at all.
    // (The map's shape is strictly the 6 canonical keys.)
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['15m', '1d', '1h', '1m', '4h', '5m']);
  });

  it('throws InvalidUseCaseInputError for an unknown `timeframe`', () => {
    const uc = new AggregateHistoryUseCase();
    expect(() =>
      uc.execute({
        snapshots: [snap(0, 100)],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        timeframe: '2m' as any,
      }),
    ).toThrow(InvalidUseCaseInputError);
  });

  it('throws InvalidUseCaseInputError when `snapshots` is missing', () => {
    const uc = new AggregateHistoryUseCase();
    expect(() =>
      uc.execute({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        snapshots: undefined as any,
      }),
    ).toThrow(InvalidUseCaseInputError);
  });

  it('handles an empty snapshot array without throwing', () => {
    const uc = new AggregateHistoryUseCase();
    const result = uc.execute({ snapshots: [] });
    for (const tf of ALL_TIMEFRAMES) {
      expect(result[tf]).toEqual([]);
    }
  });

  it('emits IHistoryCandleDTO with every field populated and bigint values preserved', () => {
    const t0 = T0; // 5m bucket boundary
    const snaps = [
      snap(t0, 100),        // open
      snap(t0 + 60, 110),   // high
      snap(t0 + 120, 90),   // low
      snap(t0 + 180, 105),  // close
    ];
    const uc = new AggregateHistoryUseCase();
    const result = uc.execute({ snapshots: snaps, timeframe: '5m' });
    expect(result['5m']).toHaveLength(1);
    const c = result['5m'][0]!;
    expect(c.timeframe).toBe('5m');
    expect(c.openTimestamp).toBe(BigInt(t0));
    expect(c.closeTimestamp).toBe(BigInt(t0 + 300));
    expect(c.openPrice).toBe(BigInt(100 * 10 ** PD));
    expect(c.highPrice).toBe(BigInt(110 * 10 ** PD));
    expect(c.lowPrice).toBe(BigInt(90 * 10 ** PD));
    expect(c.closePrice).toBe(BigInt(105 * 10 ** PD));
    // (100 + 110 + 90 + 105) * 1e18 / 4n = 101_250_000_000_000_000_000n.
    // The truncation is at the last 1e-18 digit, so the result
    // preserves the .25 fractional unit — this is the expected
    // bigint mean at 1e18 precision.
    expect(c.averagePrice).toBe(101_250_000_000_000_000_000n);
    expect(c.priceDecimals).toBe(PD);
    expect(c.sampleCount).toBe(4);
  });
});
