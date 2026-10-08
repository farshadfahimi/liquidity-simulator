// app/core/test/application/use_cases/get_pool_history_flat.test.ts
//
// Unit tests for the pure `isFlatSeries` helper that decides
// when the on-chain fetch produced a "visually dead" series and
// the use case should fall back to synthetic data.
//
// Public RPCs without archive state return either:
//   - bit-identical snapshots for every historical block, OR
//   - a near-flat drifting series (a few ULP changes between blocks)
// that the user's eye can't resolve on a chart. Both must trigger
// the synthetic fallback so the chart at least shows movement.

import { describe, it, expect } from 'vitest';

import { isFlatSeries } from '@core/application/use_cases/get_pool_history.use_case';
import type { IHistorySnapshotDTO } from '@core/application/dtos';

const snap = (
  price: string,
  tick: number,
  ts: number,
): IHistorySnapshotDTO => ({
  blockNumber: BigInt(ts),
  timestamp: BigInt(ts),
  tick,
  price: BigInt(price),
  priceDecimals: 6,
});

describe('isFlatSeries', () => {
  it('returns flat when fewer than 2 snapshots', () => {
    expect(isFlatSeries([])).toMatchObject({ flat: true });
    expect(isFlatSeries([snap('100000', 1, 1)])).toMatchObject({ flat: true });
  });

  it('returns flat when ALL snapshots are bit-identical', () => {
    const series = [
      snap('342000', 100, 1),
      snap('342000', 100, 2),
      snap('342000', 100, 3),
    ];
    const r = isFlatSeries(series);
    expect(r.flat).toBe(true);
    expect(r.reason).toMatch(/identical state/i);
  });

  it('returns flat when all snapshots are within 5bps of the first', () => {
    // base = 342000 (priceDecimals=6 → 0.342), 5bps = 17100 (≈0.00017 at 6 decimals)
    const series = [
      snap('342000', 100, 1),
      snap('342050', 100, 2), // drift of 50 → ~0.0015%
      snap('342020', 100, 3), // drift of 20
    ];
    const r = isFlatSeries(series);
    expect(r.flat).toBe(true);
    expect(r.reason).toMatch(/visually flat/i);
    expect(r.reason).toContain('5bps');
  });

  it('does NOT flag a > 5bps drift as flat (real price movement)', () => {
    // base = 342000, >0.05% drift = ±171 (using integer math: 342000 * 5 / 10000 = 171)
    const series = [
      snap('342000', 100, 1),
      snap('344000', 101, 2), // +2000 = ~0.58% — well above 5bps
    ];
    const r = isFlatSeries(series);
    expect(r.flat).toBe(false);
    expect(r.reason).toBe('');
  });

  it('handles a single outlier in the middle of an otherwise flat series', () => {
    // base 342000, threshold 171. Outlier at 400000 = +58000 well outside.
    const series = [
      snap('342000', 100, 1),
      snap('400000', 110, 2),
      snap('342000', 100, 3),
    ];
    const r = isFlatSeries(series);
    expect(r.flat).toBe(false);
  });
});
