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
//
// Since the chart now consumes **daily OHLC candles** produced by
// the `HistoryAggregator` (timeframe `'1d'`), every fixture below
// is an `IHistoryCandleDTO` — not a raw `IHistorySnapshotDTO`.

import { describe, it, expect, vi } from 'vitest';
import type { UTCTimestamp } from 'lightweight-charts';
import type { IHistoryCandleDTO } from '@core/application/dtos';
import type { TPoolTvlPoint } from '@core/shared/types';

import {
  applyDataAndOverlays,
  buildPriceChart,
  buildSwingMarkers,
  candleTimeRange,
  candlesToOhlc,
  clipTvlPointsToRange,
  exactPriceToNumber,
  findSwingPoints,
  formatAxisPrice,
  formatCompactUsd,
  formatCrosshair,
  syncTvlSeries,
  toLinePoints,
  toTvlLinePoints,
  TVL_PANE_INDEX,
  type ILightweightChartsModule,
} from '../../../utils/priceChart';

/** Seconds in one UTC day. */
const SECONDS_PER_DAY = 86_400;

// ---------------------------------------------------------------------------
// Candle fixture — a doji (open == high == low == close) at the given
// UTC-midnight `openTs`, price scaled by `decimals`. The old chart
// collapsed one snapshot-per-day into a doji, so a doji candle here
// is the faithful equivalent for the swing/line logic under test.
// ---------------------------------------------------------------------------
function candle(
  openTs: number,
  price: string,
  decimals = 6,
): IHistoryCandleDTO {
  return {
    timeframe: '1d',
    openTimestamp: BigInt(openTs),
    closeTimestamp: BigInt(openTs) + BigInt(SECONDS_PER_DAY),
    openPrice: BigInt(price),
    highPrice: BigInt(price),
    lowPrice: BigInt(price),
    closePrice: BigInt(price),
    averagePrice: BigInt(price),
    priceDecimals: decimals,
    sampleCount: 1,
  };
}

// Minimal v5-shape mocks. If the builder calls ANY of the
// removed v4 methods (`addAreaSeries`, `addLineSeries`,
// `addCandlestickSeries`, `series.setMarkers`, ...) the mock
// throws "is not a function" and the test fails.
//
// The mock also emulates the v5 **pane** semantics: a series added
// with a `paneIndex` beyond the current maximum creates that pane
// on demand (exactly what the real library does), and
// `chart.panes()` reports them back.
function createMockLw(): {
  module: ILightweightChartsModule;
  spy: {
    addSeries: ReturnType<typeof vi.fn>;
    setData: ReturnType<typeof vi.fn>;
    createPriceLine: ReturnType<typeof vi.fn>;
    removePriceLine: ReturnType<typeof vi.fn>;
    createSeriesMarkers: ReturnType<typeof vi.fn>;
    setMarkers: ReturnType<typeof vi.fn>;
    removeSeries: ReturnType<typeof vi.fn>;
    setStretchFactor: ReturnType<typeof vi.fn>;
  };
  priceLines: { removed: number[] };
  series: {
    created: { kind: string; paneIndex: number | undefined; data: unknown[] }[];
    removed: unknown[];
  };
  panes: { stretch: number[] };
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

  const series = {
    created: [] as { kind: string; paneIndex: number | undefined; data: unknown[] }[],
    removed: [] as unknown[],
  };
  const panes = { stretch: [] as number[] };
  const removeSeries = vi.fn((s: unknown) => {
    series.removed.push(s);
  });
  const setStretchFactor = vi.fn((factor: number) => {
    panes.stretch.push(factor);
  });

  let maxPaneIndex = 0;
  const addSeries = vi.fn((
    definition: { __kind?: string },
    _options: unknown,
    paneIndex?: number,
  ) => {
    const entry = {
      kind: definition?.__kind ?? 'unknown',
      paneIndex,
      data: [] as unknown[],
    };
    series.created.push(entry);
    maxPaneIndex = Math.max(maxPaneIndex, paneIndex ?? 0);

    return {
      setData: vi.fn((points: unknown) => {
        entry.data.push(points);
        setData(points);
      }),
      createPriceLine,
      removePriceLine,
    };
  });

  const priceScaleApply = vi.fn();
  const createChart = vi.fn(() => ({
    addSeries,
    timeScale: () => ({ fitContent: vi.fn() }),
    priceScale: () => ({ applyOptions: priceScaleApply }),
    subscribeCrosshairMove: vi.fn(),
    remove: vi.fn(),
    removeSeries,
    panes: () => Array.from({ length: maxPaneIndex + 1 }, (_, index) => ({
      paneIndex: index,
      setStretchFactor,
    })),
  }));

  return {
    module: {
      AreaSeries: { __kind: 'AreaSeries' },
      LineSeries: { __kind: 'LineSeries' },
      CandlestickSeries: { __kind: 'CandlestickSeries' },
      LineStyle: { Solid: 'solid', Dashed: 'dashed' },
      createChart,
      createSeriesMarkers,
    } as unknown as ILightweightChartsModule,
    spy: {
      addSeries,
      setData,
      createPriceLine,
      removePriceLine,
      createSeriesMarkers,
      setMarkers,
      removeSeries,
      setStretchFactor,
    },
    priceLines,
    series,
    panes,
  };
}

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

  describe('candlesToOhlc', () => {
    it('maps daily candles to the chart OHLC shape (time = openTimestamp)', () => {
      const D1 = 1_704_067_200;
      const ohlc = candlesToOhlc([
        candle(D1, '100000'),
        candle(D1 + SECONDS_PER_DAY, '200000'),
      ]);
      expect(ohlc).toHaveLength(2);
      expect(ohlc[0]).toMatchObject({
        time: D1,
        open: 0.1,
        high: 0.1,
        low: 0.1,
        close: 0.1,
        decimals: 6,
      });
      expect(ohlc[1]!.close).toBe(0.2);
    });
    it('returns [] for empty candles', () => {
      expect(candlesToOhlc([])).toEqual([]);
    });
  });

  describe('toLinePoints', () => {
    it('emits one area-series point per daily candle (time = openTimestamp, value = close)', () => {
      const D1 = 1_704_067_200;
      const points = toLinePoints([
        candle(D1, '110000'),
        candle(D1 + SECONDS_PER_DAY, '200000'),
      ]);
      expect(points).toEqual([
        { time: D1 as UTCTimestamp,                  value: 0.11 },
        { time: (D1 + SECONDS_PER_DAY) as UTCTimestamp, value: 0.2 },
      ]);
    });
    it('returns [] for empty candles', () => {
      expect(toLinePoints([])).toEqual([]);
    });
  });

  describe('findSwingPoints', () => {
    const D1 = 1_704_067_200;

    it('returns the global max as swing high and global min as swing low (one each, not many)', () => {
      // 5 daily candles: prices [0.10, 0.15, 0.08, 0.12, 0.09].
      const candles = [
        candle(D1, '100000'),
        candle(D1 + SECONDS_PER_DAY, '150000'),
        candle(D1 + 2 * SECONDS_PER_DAY, '80000'),
        candle(D1 + 3 * SECONDS_PER_DAY, '120000'),
        candle(D1 + 4 * SECONDS_PER_DAY, '90000'),
      ];
      const swings = findSwingPoints(candles);
      expect(swings).toHaveLength(2);
      const high = swings.find((s) => s.kind === 'high')!;
      const low = swings.find((s) => s.kind === 'low')!;
      expect(high.price).toBe(0.15);
      expect(high.time).toBe(D1 + SECONDS_PER_DAY);
      expect(low.price).toBe(0.08);
      expect(low.time).toBe(D1 + 2 * SECONDS_PER_DAY);
    });
    it('returns markers in chronological (time-ascending) order', () => {
      // Prices across 3 days: [0.10, 0.05, 0.08]. Max=0.10 (D1),
      // min=0.05 (D1-1d). Sorted asc by time ⇒ low first.
      const candles = [
        candle(D1, '100000'),
        candle(D1 - SECONDS_PER_DAY, '50000'),
        candle(D1 - 2 * SECONDS_PER_DAY, '80000'),
      ];
      const swings = findSwingPoints(candles);
      expect(swings.map((s) => s.time)).toEqual([D1 - SECONDS_PER_DAY, D1]);
    });
    it('keeps the first occurrence on ties', () => {
      // Two candles share the max price (0.12). The earlier one
      // (chronologically) must be the swing high.
      const candles = [
        candle(D1, '120000'),
        candle(D1 + SECONDS_PER_DAY, '120000'),
      ];
      const swings = findSwingPoints(candles);
      const high = swings.find((s) => s.kind === 'high')!;
      expect(high.time).toBe(D1);
    });
    it('returns [] when window <= 0 (markers disabled)', () => {
      expect(findSwingPoints([candle(1, '100')], 0)).toEqual([]);
      expect(findSwingPoints([candle(1, '100')], -5)).toEqual([]);
    });
    it('returns [] for fewer than 2 daily candles', () => {
      expect(findSwingPoints([])).toEqual([]);
      expect(findSwingPoints([candle(D1, '100')])).toEqual([]);
    });
    it('produces exactly ONE swing high and ONE swing low on a 30-day series with one peak and one trough', () => {
      const prices = [
        100, 103, 106, 109, 114, 117, 120, 123, 127, 131,
        135, 141, 146, 150, 149, 141, 133, 123, 113, 103,
         99, 104, 109, 113, 118, 123, 128, 133, 138, 143,
      ];
      const candles = prices.map((p, i) => candle(D1 + i * SECONDS_PER_DAY, `${p}000000`));
      const swings = findSwingPoints(candles);
      const highs = swings.filter((s) => s.kind === 'high');
      const lows = swings.filter((s) => s.kind === 'low');
      expect(highs).toHaveLength(1);
      expect(lows).toHaveLength(1);
      expect(highs[0]!.price).toBe(150);
      expect(highs[0]!.time).toBe(D1 + 13 * SECONDS_PER_DAY);
      expect(lows[0]!.price).toBe(99);
      expect(lows[0]!.time).toBe(D1 + 20 * SECONDS_PER_DAY);
    });
  });

  describe('buildSwingMarkers', () => {
    it('places swing high aboveBar with arrowDown + red color, swing low belowBar with arrowUp + green color', () => {
      const markers = buildSwingMarkers(
        [
          { index: 0, time: 1_000 as UTCTimestamp, price: 80, kind: 'low' },
          { index: 1, time: 1_001 as UTCTimestamp, price: 150, kind: 'high' },
        ],
        'USDC',
      );
      const high = markers.find((m) => m.position === 'aboveBar')!;
      const low = markers.find((m) => m.position === 'belowBar')!;
      expect(high.shape).toBe('arrowDown');
      expect(high.color).toMatch(/248,\s*113,\s*113/);
      expect(low.shape).toBe('arrowUp');
      expect(low.color).toMatch(/34,\s*197,\s*94/);
      expect(high.text).toContain('swing high');
      expect(low.text).toContain('swing low');
    });
  });

  describe('buildPriceChart', () => {
    it('uses the v5 API: chart.addSeries(AreaSeries, ...) and createSeriesMarkers — NOT addAreaSeries/addCandlestickSeries/series.setMarkers', () => {
      const { module, spy } = createMockLw();
      buildPriceChart({
        candles: [candle(1_000, '100000')],
        strategyRange: null,
        token0Symbol: 'WETH',
        token1Symbol: 'USDC',
      }, module, {} as HTMLElement);

      expect(spy.addSeries).toHaveBeenCalledTimes(1);
      expect(spy.addSeries.mock.calls[0]![0]).toBe(module.AreaSeries);
      expect(spy.createSeriesMarkers).toHaveBeenCalledTimes(1);
      expect(spy.setMarkers).toHaveBeenCalled();
    });

    it('creates three price lines (lower, upper, now)', () => {
      const { module, spy } = createMockLw();
      buildPriceChart({
        candles: [candle(1_000, '340000'), candle(1_001, '350000')],
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

    it('hides the lower line when lowerPrice is null (out-of-scale), keeps upper when finite>0 (degenerate-range guard)', () => {
      const { module, spy } = createMockLw();
      buildPriceChart({
        candles: [candle(1_000, '350000')],
        strategyRange: {
          strategyName: 'Test',
          lowerPrice: null,
          upperPrice: 1.5,
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
        candles: [candle(1_000, '100000')],
        strategyRange: null,
        token0Symbol: 'WETH',
        token1Symbol: 'USDC',
      }, module, {} as HTMLElement);

      expect(priceScaleApply).toHaveBeenCalledTimes(1);
      const opts = priceScaleApply.mock.calls[0]![0] as Record<string, unknown>;
      expect(opts.minimumWidth).toBeGreaterThanOrEqual(40);
      // v5 renamed the v3/v4 `drawTicks` option to `ticksVisible`;
      // the old name is silently ignored by the library.
      expect(opts.ticksVisible).toBe(true);
      expect(opts.drawTicks).toBeUndefined();
    });

    it('replaces markers when applyDataAndOverlays is called twice (no accumulation)', () => {
      const { module, spy } = createMockLw();
      const handles = buildPriceChart({
        candles: [candle(1_000, '100000')],
        strategyRange: null,
        token0Symbol: 'WETH',
        token1Symbol: 'USDC',
      }, module, {} as HTMLElement);
      const callsBefore = spy.setMarkers.mock.calls.length;

      const plugin = handles.markers;
      applyDataAndOverlays(
        handles.series,
        {
          candles: [candle(2_000, '200000')],
          strategyRange: null,
          token0Symbol: 'WETH',
          token1Symbol: 'USDC',
        },
        module,
        handles.priceLines,
        plugin,
      );
      expect(spy.setMarkers.mock.calls.length - callsBefore).toBe(1);
    });
  });

  describe('applyDataAndOverlays', () => {
    it('removes stale overlays before adding new ones', () => {
      const { module, spy } = createMockLw();
      const handles = buildPriceChart({
        candles: [candle(1_000, '100000')],
        strategyRange: { strategyName: 'A', lowerPrice: 0.0001, upperPrice: 0.0002, score: 0.5, expectedApr: 5 },
        token0Symbol: 'WETH',
        token1Symbol: 'USDC',
      }, module, {} as HTMLElement);
      expect(handles.priceLines).toHaveLength(3);

      const fresh = applyDataAndOverlays(
        handles.series,
        {
          candles: [candle(2_000, '200000')],
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
    it('renders the latest candle close + range as human text', async () => {
      const { buildPriceBadge } = await import('../../../utils/priceChart');
      const badge = buildPriceBadge({
        candles: [
          candle(1_700_000_000, '100000'),
          candle(1_700_086_400, '342000'),
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
    it('handles empty candles gracefully', async () => {
      const { buildPriceBadge } = await import('../../../utils/priceChart');
      const badge = buildPriceBadge({
        candles: [],
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
      const D1 = 1_704_067_200;
      const badge = buildPriceBadge({
        candles: [
          candle(D1, '100000'),
          candle(D1 + SECONDS_PER_DAY, '150000'),
          candle(D1 + 2 * SECONDS_PER_DAY, '80000'),
          candle(D1 + 3 * SECONDS_PER_DAY, '120000'),
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

  // -------------------------------------------------------------------------
  // TVL roadmap slice 5 — the optional second pane
  // -------------------------------------------------------------------------
  describe('TVL series (second pane)', () => {
    const D1 = 1_704_067_200;

    /** A TVL point: unix seconds + USD at 6 decimals. */
    function tvl(timestamp: number, usd: number): TPoolTvlPoint {
      return {
        timestamp: BigInt(timestamp),
        tvlUsd: BigInt(Math.round(usd * 1_000_000)),
      };
    }

    describe('toTvlLinePoints', () => {
      it('converts the 6-decimal USD bigint to plain dollars', () => {
        const points = toTvlLinePoints([
          tvl(D1, 1.5),
          tvl(D1 + SECONDS_PER_DAY, 2_500),
        ]);
        expect(points).toEqual([
          { time: D1 as UTCTimestamp, value: 1.5 },
          { time: (D1 + SECONDS_PER_DAY) as UTCTimestamp, value: 2500 },
        ]);
      });

      it('returns [] for an empty history', () => {
        expect(toTvlLinePoints([])).toEqual([]);
      });
    });

    describe('clipTvlPointsToRange', () => {
      it('keeps only the points inside the range (bounds inclusive)', () => {
        const points = [
          tvl(D1 - 1_000, 1),
          tvl(D1, 2),
          tvl(D1 + 1_000, 3),
        ];
        expect(clipTvlPointsToRange(points, D1, D1 + 1_000)).toEqual([
          tvl(D1, 2),
          tvl(D1 + 1_000, 3),
        ]);
      });

      it('returns [] for an inverted or non-finite range', () => {
        const points = [tvl(D1, 1)];
        expect(clipTvlPointsToRange(points, D1 + 10, D1)).toEqual([]);
        expect(clipTvlPointsToRange(points, NaN, D1)).toEqual([]);
      });
    });

    describe('candleTimeRange', () => {
      it('spans from the first candle open to the last candle close', () => {
        const range = candleTimeRange([
          candle(D1, '100000'),
          candle(D1 + SECONDS_PER_DAY, '200000'),
        ]);
        expect(range).toEqual({
          start: D1,
          end: D1 + 2 * SECONDS_PER_DAY,
        });
      });

      it('returns null for an empty candle list', () => {
        expect(candleTimeRange([])).toBeNull();
      });
    });

    describe('buildPriceChart', () => {
      it('creates NO TVL series and NO second pane when there are no TVL points', () => {
        const { module, spy, panes } = createMockLw();
        const handles = buildPriceChart({
          candles: [candle(D1, '100000')],
          strategyRange: null,
          token0Symbol: 'WETH',
          token1Symbol: 'USDC',
        }, module, {} as HTMLElement);

        expect(handles.tvlSeries).toBeNull();
        expect(spy.addSeries).toHaveBeenCalledTimes(1);
        expect(spy.addSeries.mock.calls[0]![0]).toBe(module.AreaSeries);
        expect(panes.stretch).toEqual([]);
      });

      it('adds the TVL line to the SECOND pane (paneIndex 1) and returns it', () => {
        const { module, spy, series, panes } = createMockLw();
        const handles = buildPriceChart({
          candles: [candle(D1, '100000')],
          strategyRange: null,
          token0Symbol: 'WETH',
          token1Symbol: 'USDC',
          tvlPoints: [tvl(D1, 1_500), tvl(D1 + SECONDS_PER_DAY, 2_000)],
        }, module, {} as HTMLElement);

        expect(spy.addSeries).toHaveBeenCalledTimes(2);
        expect(spy.addSeries.mock.calls[1]![0]).toBe(module.LineSeries);
        expect(spy.addSeries.mock.calls[1]![2]).toBe(TVL_PANE_INDEX);
        expect(handles.tvlSeries).not.toBeNull();

        // The pane heights: price 3/4, TVL 1/4.
        expect(panes.stretch).toEqual([3, 1]);

        // The series carries the converted USD values.
        expect(series.created[1]!.data[0]).toEqual([
          { time: D1 as UTCTimestamp, value: 1500 },
          { time: (D1 + SECONDS_PER_DAY) as UTCTimestamp, value: 2000 },
        ]);
      });
    });

    describe('syncTvlSeries', () => {
      it('updates an existing series in place', () => {
        const { module, series } = createMockLw();
        const handles = buildPriceChart({
          candles: [candle(D1, '100000')],
          strategyRange: null,
          token0Symbol: 'WETH',
          token1Symbol: 'USDC',
          tvlPoints: [tvl(D1, 1)],
        }, module, {} as HTMLElement);

        const next = syncTvlSeries(
          handles.chart,
          module,
          handles.tvlSeries,
          [tvl(D1, 2), tvl(D1 + SECONDS_PER_DAY, 3)],
        );

        expect(next).toBe(handles.tvlSeries);
        expect(series.created).toHaveLength(2); // no new series created
        expect(series.created[1]!.data).toHaveLength(2); // data replaced
        expect(series.created[1]!.data[1]).toEqual([
          { time: D1 as UTCTimestamp, value: 2 },
          { time: (D1 + SECONDS_PER_DAY) as UTCTimestamp, value: 3 },
        ]);
      });

      it('removes the series when the history becomes empty', () => {
        const { module, spy } = createMockLw();
        const handles = buildPriceChart({
          candles: [candle(D1, '100000')],
          strategyRange: null,
          token0Symbol: 'WETH',
          token1Symbol: 'USDC',
          tvlPoints: [tvl(D1, 1)],
        }, module, {} as HTMLElement);

        const next = syncTvlSeries(handles.chart, module, handles.tvlSeries, []);

        expect(next).toBeNull();
        expect(spy.removeSeries).toHaveBeenCalledTimes(1);
      });

      it('creates the series on demand when there was none', () => {
        const { module, spy } = createMockLw();
        const handles = buildPriceChart({
          candles: [candle(D1, '100000')],
          strategyRange: null,
          token0Symbol: 'WETH',
          token1Symbol: 'USDC',
        }, module, {} as HTMLElement);

        const next = syncTvlSeries(handles.chart, module, null, [tvl(D1, 1)]);

        expect(next).not.toBeNull();
        expect(spy.addSeries).toHaveBeenCalledTimes(2);
        expect(spy.addSeries.mock.calls[1]![2]).toBe(TVL_PANE_INDEX);
      });

      it('is a no-op when there is neither a series nor points', () => {
        const { module, spy } = createMockLw();
        const handles = buildPriceChart({
          candles: [candle(D1, '100000')],
          strategyRange: null,
          token0Symbol: 'WETH',
          token1Symbol: 'USDC',
        }, module, {} as HTMLElement);

        expect(syncTvlSeries(handles.chart, module, null, [])).toBeNull();
        expect(spy.addSeries).toHaveBeenCalledTimes(1);
        expect(spy.removeSeries).not.toHaveBeenCalled();
      });
    });

    describe('formatCompactUsd', () => {
      it('formats billions / millions / thousands / plain dollars', () => {
        expect(formatCompactUsd(2_500_000_000)).toBe('$2.50B');
        expect(formatCompactUsd(1_200_000)).toBe('$1.20M');
        expect(formatCompactUsd(340_000)).toBe('$340.0K');
        expect(formatCompactUsd(12.5)).toBe('$12.50');
      });

      it('renders non-finite values as an em dash', () => {
        expect(formatCompactUsd(NaN)).toBe('—');
        expect(formatCompactUsd(Infinity)).toBe('—');
      });
    });
  });
});
