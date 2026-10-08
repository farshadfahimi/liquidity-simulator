// app/core/test/utils/priceChart.test.ts
//
// Verifies the `lightweight-charts` v5 API surface our chart
// component depends on. The bug that motivated this file: v4
// used `chart.addAreaSeries(...)`; v5 renamed it to the generic
// `chart.addSeries(<SeriesDefinition>, opts)`, and `series.setMarkers`
// was replaced by `createSeriesMarkers(series).setMarkers([...])`.
// A blind edit that reintroduces any removed v4 method now breaks
// this test before it reaches the browser.
//
// We exercise the area-series data builder, the swing-point
// detector (global max/min), the price-line overlay creation,
// the swing-marker generator, and the crosshair formatter.

import { describe, it, expect, vi } from 'vitest';

import {
  applyDataAndOverlays,
  buildPriceChart,
  buildSwingMarkers,
  exactPriceToNumber,
  findSwingPoints,
  formatAxisPrice,
  formatCrosshair,
  snapshotsToCandles,
  toLinePoints,
  type ILightweightChartsModule,
} from '../../../utils/priceChart';

// Minimal v5-shape mocks. If the builder calls ANY of the
// removed v4 methods (`addAreaSeries`, `addLineSeries`,
// `addCandlestickSeries`, `series.setMarkers`, ...) the mock
// throws "is not a function" and the test fails.
//
// We currently use `AreaSeries` (standard time-based chart with
// no candles); the test guards against the accidental re-intro
// of `addCandlestickSeries` or `addAreaSeries` (v4 names) in
// future refactors.
function createMockLw(): {
  module: ILightweightChartsModule;
  spy: {
    addSeries: ReturnType<typeof vi.fn>;
    setData: ReturnType<typeof vi.fn>;
    createPriceLine: ReturnType<typeof vi.fn>;
    removePriceLine: ReturnType<typeof vi.fn>;
    createSeriesMarkers: ReturnType<typeof vi.fn>;
    setMarkers: ReturnType<typeof vi.fn>;
  };
  priceLines: { removed: number[] };
} {
  const priceLines: { removed: number[] } = { removed: [] };
  const setData = vi.fn();
  const createPriceLine = vi.fn((opts: { price: number; title: string }) => ({
    price: opts.price,
    title: opts.title,
  }));
  const removePriceLine = vi.fn((line: { price: number }) => {
    priceLines.removed.push(line.price);
  });
  const setMarkers = vi.fn();
  const createSeriesMarkers = vi.fn(() => ({ setMarkers }));
  const addSeries = vi.fn(() => ({
    setData,
    createPriceLine,
    removePriceLine,
  }));
  const priceScaleApply = vi.fn();
  const createChart = vi.fn(() => ({
    addSeries,
    timeScale: () => ({ fitContent: vi.fn() }),
    priceScale: () => ({ applyOptions: priceScaleApply }),
    subscribeCrosshairMove: vi.fn(),
    remove: vi.fn(),
  }));

  return {
    module: {
      // v5 markers + AreaSeries.
      AreaSeries: { __kind: 'AreaSeries' },
      LineStyle: { Solid: 'solid', Dashed: 'dashed' },
      createChart,
      createSeriesMarkers,
    } as unknown as ILightweightChartsModule,
    spy: { addSeries, setData, createPriceLine, removePriceLine, createSeriesMarkers, setMarkers },
    priceLines,
  };
}

const snapshot = (price: string, ts: number, decimals = 6) => ({
  blockNumber: BigInt(ts),
  timestamp: BigInt(ts),
  tick: 0,
  price: BigInt(price),
  priceDecimals: decimals,
});

describe('priceChart utility', () => {
  describe('exactPriceToNumber', () => {
    it('returns exact fractional values (no toFixed rounding)', () => {
      expect(exactPriceToNumber(342000n, 6)).toBe(0.342);
    });
    it('handles whole numbers', () => {
      expect(exactPriceToNumber(1230000000n, 6)).toBe(1230);
    });
    it('returns 0 for 0n', () => {
      expect(exactPriceToNumber(0n, 6)).toBe(0);
    });
  });

  describe('formatAxisPrice', () => {
    it('uses locale grouping for >=1', () => {
      const out = formatAxisPrice(1234.5);
      expect(out).not.toMatch(/e/i);
      expect(Number(out.replace(/[,\s]/g, ''))).toBe(1234.5);
    });
    it('keeps up to 6 fraction digits for sub-1', () => {
      expect(formatAxisPrice(0.000342)).toBe('0.000342');
      expect(formatAxisPrice(0.00034)).toBe('0.00034');
    });
    it('renders 0 as "0"', () => {
      expect(formatAxisPrice(0)).toBe('0');
    });
  });

  describe('snapshotsToCandles', () => {
    // Delegate to `groupSnapshotsByDay` — the helper has its own
    // dedicated test suite (`groupSnapshotsByDay.test.ts`); we
    // just confirm the re-export still resolves and returns the
    // same shape here.
    it('returns the daily buckets the chart uses for series + markers', () => {
      const SECONDS_PER_DAY = 86_400;
      const D1 = 1_704_067_200;
      const candles = snapshotsToCandles([
        snapshot('100000', D1 + 100),
        snapshot('110000', D1 + 60_000),     // still D1
        snapshot('200000', D1 + SECONDS_PER_DAY + 100), // D2
      ]);
      expect(candles).toHaveLength(2);
      expect(candles[0]!.close).toBe(0.11);
      expect(candles[1]!.close).toBe(0.2);
    });
    it('returns [] for empty snapshots', () => {
      expect(snapshotsToCandles([])).toEqual([]);
    });
  });

  describe('toLinePoints', () => {
    it('emits one area-series point per UTC day (time + close of the daily bucket)', () => {
      // D1 = 2024-01-01 UTC midnight; multiple snapshots on D1
      // collapse to a single point at D1 midnight with the close
      // of the last snapshot of that day.
      const SECONDS_PER_DAY = 86_400;
      const D1 = 1_704_067_200;
      const points = toLinePoints([
        snapshot('100000', D1 + 100),     // 0.10
        snapshot('120000', D1 + 500),     // 0.12
        snapshot('110000', D1 + 60_000),  // 0.11 (last of D1)
        snapshot('200000', D1 + SECONDS_PER_DAY + 100), // 0.20 on D2
      ]);
      expect(points).toEqual([
        { time: D1,                  value: 0.11 },
        { time: D1 + SECONDS_PER_DAY, value: 0.2 },
      ]);
    });
    it('returns [] for empty snapshots', () => {
      expect(toLinePoints([])).toEqual([]);
    });
  });

  describe('findSwingPoints', () => {
    // NOTE: findSwingPoints now operates on DAILY OHLC candles
    // (collapsed from raw snapshots). To exercise the swing logic
    // the synthetic fixtures below must spread across multiple
    // UTC days — otherwise everything collapses into one doji
    // candle and the function returns []. We anchor on D1 =
    // 1_704_067_200 (UTC midnight 2024-01-01) and step by 86400.
    const SECONDS_PER_DAY = 86_400;
    const D1 = 1_704_067_200;

    it('returns the global max as swing high and global min as swing low (one each, not many)', () => {
      // 5 candles on 5 different UTC days: prices [0.10, 0.15, 0.08, 0.12, 0.09].
      const snaps = [
        snapshot('100000', D1),
        snapshot('150000', D1 + SECONDS_PER_DAY),
        snapshot('80000',  D1 + 2 * SECONDS_PER_DAY),
        snapshot('120000', D1 + 3 * SECONDS_PER_DAY),
        snapshot('90000',  D1 + 4 * SECONDS_PER_DAY),
      ];
      const swings = findSwingPoints(snaps);
      expect(swings).toHaveLength(2);
      const high = swings.find((s) => s.kind === 'high')!;
      const low = swings.find((s) => s.kind === 'low')!;
      expect(high.price).toBe(0.15);
      expect(high.time).toBe(D1 + SECONDS_PER_DAY);
      expect(low.price).toBe(0.08);
      expect(low.time).toBe(D1 + 2 * SECONDS_PER_DAY);
    });
    it('returns markers in chronological (time-ascending) order', () => {
      // Prices across 3 days: [0.10, 0.05, 0.08]. Max=0.10 (day D1),
      // min=0.05 (day D1 - 1d). Sorted asc by time ⇒ low first.
      const snaps = [
        snapshot('100000', D1),                    // day D1: 0.10 (high)
        snapshot('50000',  D1 - SECONDS_PER_DAY),  // day D1-1d: 0.05 (low)
        snapshot('80000',  D1 - 2 * SECONDS_PER_DAY), // day D1-2d: 0.08
      ];
      const swings = findSwingPoints(snaps);
      expect(swings.map((s) => s.time)).toEqual([D1 - SECONDS_PER_DAY, D1]);
    });
    it('keeps the first occurrence on ties', () => {
      // Two snapshots share the max price (0.12). The earlier
      // one (chronologically) must be the swing high.
      const snaps = [
        snapshot('120000', D1),
        snapshot('120000', D1 + SECONDS_PER_DAY),
      ];
      const swings = findSwingPoints(snaps);
      const high = swings.find((s) => s.kind === 'high')!;
      expect(high.time).toBe(D1);
    });
    it('returns [] when window <= 0 (markers disabled)', () => {
      expect(findSwingPoints([snapshot('100', 1)], 0)).toEqual([]);
      expect(findSwingPoints([snapshot('100', 1)], -5)).toEqual([]);
    });
    it('returns [] for fewer than 2 daily candles', () => {
      // Either empty input or a single-snapshot-per-day (one candle)
      // series — both must yield zero swing points.
      expect(findSwingPoints([])).toEqual([]);
      expect(findSwingPoints([snapshot('100', D1)])).toEqual([]);
    });
    it('produces exactly ONE swing high and ONE swing low on a 30-day series with one peak and one trough', () => {
      // One snapshot per day for 30 consecutive days, prices
      // tracing the classic chart-test pattern: run-up, peak at
      // day 14, pullback, trough at day 21, recovery. After
      // collapsing to daily candles we expect one swing high
      // (the global-max candle) and one swing low (the
      // global-min candle).
      const prices = [
        100, 103, 106, 109, 114, 117, 120, 123, 127, 131,
        135, 141, 146, 150, 149, 141, 133, 123, 113, 103,
         99, 104, 109, 113, 118, 123, 128, 133, 138, 143,
      ];
      const snaps = prices.map((p, i) => snapshot(`${p}000000`, D1 + i * SECONDS_PER_DAY));
      const swings = findSwingPoints(snaps);
      const highs = swings.filter((s) => s.kind === 'high');
      const lows = swings.filter((s) => s.kind === 'low');
      expect(highs).toHaveLength(1);
      expect(lows).toHaveLength(1);
      // Peak is the global max (price=150 at i=13) → its UTC-midnight
      // bucket timestamp.
      expect(highs[0]!.price).toBe(150);
      expect(highs[0]!.time).toBe(D1 + 13 * SECONDS_PER_DAY);
      // Trough is the global min (price=99 at i=20).
      expect(lows[0]!.price).toBe(99);
      expect(lows[0]!.time).toBe(D1 + 20 * SECONDS_PER_DAY);
    });
  });

  describe('buildSwingMarkers', () => {
    it('places swing high aboveBar with arrowDown + red color, swing low belowBar with arrowUp + green color', () => {
      const markers = buildSwingMarkers(
        [
          { index: 0, time: 1_000, price: 80, kind: 'low' },
          { index: 1, time: 1_001, price: 150, kind: 'high' },
        ],
        'USDC',
      );
      const high = markers.find((m) => m.position === 'aboveBar')!;
      const low = markers.find((m) => m.position === 'belowBar')!;
      expect(high.shape).toBe('arrowDown');
      expect(high.color).toMatch(/248,\s*113,\s*113/); // red palette
      expect(low.shape).toBe('arrowUp');
      expect(low.color).toMatch(/34,\s*197,\s*94/); // green palette
      expect(high.text).toContain('swing high');
      expect(low.text).toContain('swing low');
    });
  });

  describe('buildPriceChart', () => {
    it('uses the v5 API: chart.addSeries(AreaSeries, ...) and createSeriesMarkers — NOT addAreaSeries/addCandlestickSeries/series.setMarkers', () => {
      const { module, spy } = createMockLw();
      buildPriceChart({
        snapshots: [snapshot('100000', 1_000)],
        strategyRange: null,
        token0Symbol: 'WETH',
        token1Symbol: 'USDC',
      }, module, {} as HTMLElement);

      // addSeries called ONCE with the AreaSeries marker.
      expect(spy.addSeries).toHaveBeenCalledTimes(1);
      expect(spy.addSeries.mock.calls[0]![0]).toBe(module.AreaSeries);
      // createSeriesMarkers called ONCE.
      expect(spy.createSeriesMarkers).toHaveBeenCalledTimes(1);
      // setMarkers called at least once (initial empty + after data).
      expect(spy.setMarkers).toHaveBeenCalled();
    });

    it('creates three price lines (lower, upper, now)', () => {
      const { module, spy } = createMockLw();
      buildPriceChart({
        snapshots: [snapshot('340000', 1_000), snapshot('350000', 1_001)],
        strategyRange: {
          strategyName: 'Test',
          lowerPrice: 0.000_3,
          upperPrice: 0.000_4,
          score: 0.95,
          expectedApr: 12.3,
        },
        token0Symbol: 'WETH',
        token1Symbol: 'USDC',
      }, module, {} as HTMLElement);

      expect(spy.createPriceLine).toHaveBeenCalledTimes(3);
      const titles = spy.createPriceLine.mock.calls.map((c) => (c[0] as { title: string }).title);
      expect(titles.some((t) => t.startsWith('↓ '))).toBe(true);
      expect(titles.some((t) => t.startsWith('↑ '))).toBe(true);
      expect(titles).toContain('now');
    });

    it('hides the lower line when lowerPrice is 0, keeps upper when finite>0 (degenerate-range guard)', () => {
      const { module, spy } = createMockLw();
      buildPriceChart({
        snapshots: [snapshot('350000', 1_000)],
        strategyRange: {
          strategyName: 'Test',
          lowerPrice: 0,
          upperPrice: 1.5e18,
          score: 1,
          expectedApr: 99,
        },
        token0Symbol: 'WETH',
        token1Symbol: 'USDC',
      }, module, {} as HTMLElement);

      const titles = spy.createPriceLine.mock.calls.map((c) => (c[0] as { title: string }).title);
      expect(titles).toHaveLength(2);
      expect(titles.some((t) => t.startsWith('↑ '))).toBe(true);
      expect(titles.some((t) => t.startsWith('↓ '))).toBe(false);
      expect(titles).toContain('now');
    });

    it('forces the right price scale to have a minimum width and visible ticks (sidebar visibility fix)', () => {
    const { module, priceScaleApply } = (() => {
      // Re-build a one-off mock so we can grab the applyOptions spy.
      const priceLines: { removed: number[] } = { removed: [] };
      const priceScaleApply = vi.fn();
      const createChart = vi.fn(() => ({
        addSeries: vi.fn(() => ({
          setData: vi.fn(),
          createPriceLine: vi.fn(() => ({})),
          removePriceLine: vi.fn(),
        })),
        timeScale: () => ({ fitContent: vi.fn() }),
        priceScale: () => ({ applyOptions: priceScaleApply }),
        subscribeCrosshairMove: vi.fn(),
        remove: vi.fn(),
      }));
      const lw = {
        AreaSeries: {},
        LineStyle: { Solid: 'solid', Dashed: 'dashed' },
        createChart,
        createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
      } as unknown as ILightweightChartsModule;
      return { module: lw, priceScaleApply };
    })();

    buildPriceChart({
      snapshots: [snapshot('100000', 1_000)],
      strategyRange: null,
      token0Symbol: 'WETH',
      token1Symbol: 'USDC',
    }, module, {} as HTMLElement);

    // Must applyOptions on the right scale with minimumWidth and
    // drawTicks so the price labels always have room to render
    // even when the chart container is narrow.
    expect(priceScaleApply).toHaveBeenCalledTimes(1);
    const opts = priceScaleApply.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.minimumWidth).toBeGreaterThanOrEqual(40);
    expect(opts.drawTicks).toBe(true);
  });

  it('replaces markers when applyDataAndOverlays is called twice (no accumulation)', () => {
      const { module, spy } = createMockLw();
      const handles = buildPriceChart({
        snapshots: [snapshot('100000', 1_000)],
        strategyRange: null,
        token0Symbol: 'WETH',
        token1Symbol: 'USDC',
      }, module, {} as HTMLElement);
      const callsBefore = spy.setMarkers.mock.calls.length;

      const plugin = handles.markers;
      applyDataAndOverlays(
        handles.series,
        {
          snapshots: [snapshot('200000', 2_000)],
          strategyRange: null,
          token0Symbol: 'WETH',
          token1Symbol: 'USDC',
        },
        module,
        handles.priceLines,
        plugin,
      );
      // Exactly ONE new setMarkers call (replace, not append).
      expect(spy.setMarkers.mock.calls.length - callsBefore).toBe(1);
    });
  });

  describe('applyDataAndOverlays', () => {
    it('removes stale overlays before adding new ones', () => {
      const { module, spy } = createMockLw();
      const handles = buildPriceChart({
        snapshots: [snapshot('100000', 1_000)],
        strategyRange: { strategyName: 'A', lowerPrice: 0.0001, upperPrice: 0.0002, score: 0.5, expectedApr: 5 },
        token0Symbol: 'WETH',
        token1Symbol: 'USDC',
      }, module, {} as HTMLElement);
      expect(handles.priceLines).toHaveLength(3);

      const fresh = applyDataAndOverlays(
        handles.series,
        {
          snapshots: [snapshot('200000', 2_000)],
          strategyRange: null,
          token0Symbol: 'WETH',
          token1Symbol: 'USDC',
        },
        module,
        handles.priceLines,
        handles.markers,
      );
      expect(spy.removePriceLine).toHaveBeenCalledTimes(3);
      expect(fresh).toHaveLength(1); // only "now" remains
    });
  });

  describe('formatCrosshair', () => {
    it('formats numeric time + price + symbols', () => {
      const text = formatCrosshair({
        time: 1_700_000_000 as never,
        price: 0.000342,
        token0Symbol: 'WETH',
        token1Symbol: 'USDC',
      });
      expect(text).toMatch(/USDC \/ WETH$/);
      expect(text).not.toMatch(/NaN/);
    });
    it('gracefully handles string time', () => {
      const text = formatCrosshair({
        time: '2024-01-01' as never,
        price: 1.5,
        token0Symbol: 'A',
        token1Symbol: 'B',
      });
      expect(text).toContain('2024-01-01');
      expect(text).toMatch(/B \/ A$/);
    });
  });

  describe('buildPriceBadge', () => {
    it('renders the latest snapshot price + range as human text', async () => {
      const { buildPriceBadge } = await import('../../../utils/priceChart');
      const badge = buildPriceBadge({
        snapshots: [
          { blockNumber: 1n, timestamp: 1_700_000_000n, tick: 0, price: 100_000n, priceDecimals: 6 },
          { blockNumber: 2n, timestamp: 1_700_001_000n, tick: 0, price: 342_000n, priceDecimals: 6 },
        ],
        strategyRange: {
          strategyName: 'X',
          lowerPrice: 0.0003,
          upperPrice: 0.0005,
          score: 1,
          expectedApr: 10,
        },
        token1Symbol: 'USDC',
        token0Symbol: 'WETH',
      });
      expect(badge.lastPrice).toMatch(/0\.342 USDC \/ WETH/);
      expect(badge.lastTime).toMatch(/[A-Z][a-z]{2} \d{1,2}/);
      expect(badge.rangeLabel).toContain('0.0003');
      expect(badge.rangeLabel).toContain('0.0005');
    });
    it('handles empty snapshots gracefully', async () => {
      const { buildPriceBadge } = await import('../../../utils/priceChart');
      const badge = buildPriceBadge({
        snapshots: [],
        strategyRange: null,
        token1Symbol: 'USDC',
        token0Symbol: 'WETH',
      });
      expect(badge.lastPrice).toBe('— USDC / WETH');
      expect(badge.lastTime).toBe('');
      expect(badge.rangeLabel).toBe('');
    });
    it('surfaces swing high / low labels for the global extrema', async () => {
      const { buildPriceBadge } = await import('../../../utils/priceChart');
      // Spread across 4 distinct UTC days so the candle collapse
      // yields 4 separate candles (not 1 doji).
      const D1 = 1_704_067_200n;
      const SECONDS_PER_DAY = 86_400n;
      const badge = buildPriceBadge({
        snapshots: [
          { blockNumber: 1n, timestamp: D1,                       tick: 0, price: 100_000n, priceDecimals: 6 },
          { blockNumber: 2n, timestamp: D1 + SECONDS_PER_DAY,     tick: 0, price: 150_000n, priceDecimals: 6 },
          { blockNumber: 3n, timestamp: D1 + 2n * SECONDS_PER_DAY, tick: 0, price: 80_000n,  priceDecimals: 6 },
          { blockNumber: 4n, timestamp: D1 + 3n * SECONDS_PER_DAY, tick: 0, price: 120_000n, priceDecimals: 6 },
        ],
        strategyRange: null,
        token1Symbol: 'USDC',
        token0Symbol: 'WETH',
      });
      expect(badge.swingHighLabel).toContain('high');
      expect(badge.swingHighLabel).toContain('0.15');
      expect(badge.swingLowLabel).toContain('low');
      expect(badge.swingLowLabel).toContain('0.08');
    });
  });
});
