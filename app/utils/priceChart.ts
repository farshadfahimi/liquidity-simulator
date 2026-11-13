// app/utils/priceChart.ts
//
// Pure chart-build helper for `PriceChart.client.vue`, extracted
// from the Vue component so the heavyweight `lightweight-charts`
// instance can be built and asserted in a plain Vitest harness
// (no jsdom / SFC mount required).
//
// The component injects the `lightweight-charts` namespace so a
// test can pass a mock with ONLY the current v5 API surface
// (`addSeries`, `AreaSeries`, `createSeriesMarkers`, ...). If a
// future refactor reintroduces a removed/renamed method (the
// exact bug we hit with `addAreaSeries` from v4), the mock lacks
// it and the test throws — catching the regression before it
// reaches the browser.
//
// v5 API note: lightweight-charts v5 dropped `addAreaSeries`,
// `addLineSeries`, `addCandlestickSeries` in favour of a single
// generic `chart.addSeries(<SeriesDefinition>, options)`. Series
// constructors like `AreaSeries`, `LineSeries`, `CandlestickSeries`
// are exported as objects the consumer passes to `addSeries`.
//
// Chart primitive: `AreaSeries` — a STANDARD time-based chart
// (no candles).
//
// The chart consumes **daily OHLC candles** produced by the
// `HistoryAggregator` (timeframe `'1d'`) — see
// `get_pool_history.use_case.ts:buildCandles` and
// `aggregate_history.use_case.ts`. The `ChartsTab` requests
// `withCandles: ['1d']` and passes `history.candles['1d']` to
// this component. Each candle already carries open/high/low/close,
// so the x-axis lines up to UTC midnight and the swing markers are
// driven from each day's `high` / `low` rather than from a
// client-side re-bucketing of raw snapshots — which is what the
// user explicitly asked for ("show swing high and swing low").

import type {
  IChartApi,
  ISeriesApi,
  IPriceLine,
  ISeriesMarkersPluginApi,
  Time,
  UTCTimestamp,
  AreaData,
  SeriesMarker,
} from 'lightweight-charts';
import type { IHistoryCandleDTO } from '@core/application/dtos';
import type { IOhlcCandle } from './groupSnapshotsByDay';

/**
 * Minimal structural surface of the chart library the builder
 * needs. v5 requires `AreaSeries` to be passed as the first
 * argument to `chart.addSeries(...)`. `createSeriesMarkers` is
 * the v5 marker-plugin API (replacing v4's `series.setMarkers`
 * hung off the series directly).
 */
export interface ILightweightChartsModule {
  createChart(container: HTMLElement, options?: unknown): IChartApi;
  /** v5 — `chart.addSeries(AreaSeries, opts)`. */
  AreaSeries: object;
  /**
   * v5 — `const m = createSeriesMarkers(series); m.setMarkers([...])`.
   * v4 hung `setMarkers` off the series itself; that's gone in v5.
   */
  createSeriesMarkers(series: ISeriesApi<unknown>, markers?: SeriesMarker<UTCTimestamp>[], options?: unknown): ISeriesMarkersPluginApi<UTCTimestamp>;
  LineStyle: {
    Solid: unknown;
    Dashed: unknown;
  };
}

export interface IPriceChartRange {
  strategyName: string;
  /**
   * Lower / upper price in *human* units. `null` when the band's
   * bounds round to 0 or exceed the displayable scale (e.g. a
   * full V3 range). The chart treats `null` as "no line".
   */
  lowerPrice: number | null;
  upperPrice: number | null;
  score: number;
  expectedApr: number;
}

export interface IPriceChartInput {
  /** Daily OHLC candles (from `HistoryAggregator`, timeframe `'1d'`). */
  candles: readonly IHistoryCandleDTO[];
  strategyRange?: IPriceChartRange | null;
  token0Symbol: string;
  token1Symbol: string;
  /** Synthetic series — kept on the public type for back-compat, but
   * ignored in the line path (a single price point IS the truth). */
  synthetic?: boolean;
  /**
   * Set to 0 to disable swing markers entirely. Any non-zero
   * value (default 3) emits exactly one swing-high marker
   * (global max) and one swing-low marker (global min).
   */
  swingWindow?: number;
}

export interface IPriceChartHandles {
  chart: IChartApi;
  series: ISeriesApi<'Area'>;
  /** Created overlay lines (lower/upper range + "now"). */
  priceLines: IPriceLine[];
  /** Series markers plugin (so the component can call setMarkers on update). */
  markers: ISeriesMarkersPluginApi<UTCTimestamp>;
}

/** Intl formatter shared by the axis/label + tooltip helpers. */
const axisFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 6,
  useGrouping: true,
});

/** Exact bigint->number conversion (see component docstring). */
export function exactPriceToNumber(price: bigint, decimals: number): number {
  if (price === 0n) return 0;
  const abs = price < 0n ? -price : price;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const wholeNum = Number(whole);
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  if (fracStr.length === 0) return price < 0n ? -wholeNum : wholeNum;
  const fracNum = Number(`0.${fracStr}`);
  return price < 0n ? -(wholeNum + fracNum) : wholeNum + fracNum;
}

/** Human-friendly price formatter (no scientific notation). */
export function formatAxisPrice(v: number | null): string {
  if (v === null) return '—';
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  if (Math.abs(v) >= 1) return axisFormatter.format(v);
  return v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

/**
 * Translate daily `HistoryAggregator` candles (`IHistoryCandleDTO`,
 * timeframe `'1d'`) into the plain `IOhlcCandle` shape the chart
 * code works with — `time` (unix seconds, aligned to midnight via
 * the aggregator's `floor(t / period)` bucketing) plus numeric
 * open/high/low/close/decimals.
 *
 * This is a pure mapping: the candles are already bucketed by the
 * aggregator, so no re-bucketing happens here. The `exactPriceToNumber`
 * conversion keeps the four OHLC fields at full precision.
 *
 * Returned candles are in the aggregator's ascending
 * `openTimestamp` order.
 */
export function candlesToOhlc(
  candles: readonly IHistoryCandleDTO[],
): IOhlcCandle[] {
  return candles.map((c) => ({
    time: Number(c.openTimestamp),
    open: exactPriceToNumber(c.openPrice, c.priceDecimals),
    high: exactPriceToNumber(c.highPrice, c.priceDecimals),
    low: exactPriceToNumber(c.lowPrice, c.priceDecimals),
    close: exactPriceToNumber(c.closePrice, c.priceDecimals),
    decimals: c.priceDecimals,
  }));
}

/**
 * Convert daily candles into area-series points — one point per
 * candle, plotting each candle's CLOSE. The x-axis lines up to
 * the candle's `openTimestamp` (midnight UTC for a `'1d'` bucket)
 * so the swing markers (driven from `high`/`low`) stay aligned
 * with the visible bars.
 *
 * Returned points are in chronological (ascending-time) order,
 * which is what `series.setData` requires — `lightweight-charts`
 * throws if the array isn't sorted ascending by `time`.
 */
export function toLinePoints(
  candles: readonly IHistoryCandleDTO[],
): AreaData<UTCTimestamp>[] {
  const out: AreaData<UTCTimestamp>[] = [];
  for (const c of candlesToOhlc(candles)) {
    out.push({
      time: c.time as UTCTimestamp,
      value: c.close,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Swing detection
// ---------------------------------------------------------------------------

export interface ISwingPoint {
  /** Index in the candles array. */
  index: number;
  /** Unix-seconds timestamp (the candle's bucket-start, UTC midnight). */
  time: UTCTimestamp;
  /** Price at the swing point (already a JS number). */
  price: number;
  /** 'high' = local maximum; 'low' = local minimum. */
  kind: 'high' | 'low';
}

/**
 * Find swing-high and swing-low points in a price series.
 *
 * Operates on the daily candles (see `candlesToOhlc`), so the
 * markers line up with the visible candles on the chart.
 *
 * Definition: the swing HIGH is the FIRST candle with the
 * highest price in the series. The swing LOW is the FIRST candle
 * with the lowest price. Ties (rare but possible with synthetic
 * data) keep the earliest occurrence.
 *
 * Why global extrema instead of local peaks: every local bump in
 * a smooth time series qualifies as a "local maximum" if the
 * window is too tight, so a local-extrema algorithm produces 5+
 * markers on a typical 30-candle series and clutters the chart
 * with redundant labels. The user-facing "swing high" / "swing low"
 * corresponds to the absolute top and bottom of the visible
 * window — which is what every popular TradingView swing indicator
 * (e.g. "Swing High/Low" with a large threshold) does in practice.
 *
 * The `window` parameter is accepted for API stability but is
 * unused — the function returns at most one swing high and one
 * swing low. Pass `window = 0` to disable markers entirely (returns
 * `[]`).
 *
 * Returns up to 2 points (one high + one low), or 0 if the series
 * is empty, has fewer than 2 points, or `window <= 0`.
 */
export function findSwingPoints(
  candles: readonly IHistoryCandleDTO[],
  window = 3,
): ISwingPoint[] {
  if (window <= 0) return [];
  const ohlc = candlesToOhlc(candles);
  if (ohlc.length < 2) return [];

  let highIdx = 0;
  let lowIdx = 0;
  for (let i = 1; i < ohlc.length; i++) {
    if (ohlc[i]!.high > ohlc[highIdx]!.high) highIdx = i;
    if (ohlc[i]!.low < ohlc[lowIdx]!.low) lowIdx = i;
  }

  const swings: ISwingPoint[] = [
    {
      index: highIdx,
      time: ohlc[highIdx]!.time as UTCTimestamp,
      price: ohlc[highIdx]!.high,
      kind: 'high',
    },
    {
      index: lowIdx,
      time: ohlc[lowIdx]!.time as UTCTimestamp,
      price: ohlc[lowIdx]!.low,
      kind: 'low',
    },
  ];

  // Chronological order — setMarkers wants ascending time.
  swings.sort((a, b) => a.time - b.time);
  return swings;
}

/**
 * Build the SeriesMarker list for setMarkers. Swing highs sit
 * ABOVE the bar with an arrow-up + label; swing lows sit BELOW
 * the bar with an arrow-down + label. Color follows the existing
 * green / red palette so it matches the strategy-range lines.
 */
export function buildSwingMarkers(
  swings: readonly ISwingPoint[],
  token1Symbol: string,
): SeriesMarker<UTCTimestamp>[] {
  return swings.map((s) => {
    const isHigh = s.kind === 'high';
    return {
      time: s.time,
      position: isHigh ? 'aboveBar' : 'belowBar',
      shape: isHigh ? 'arrowDown' : 'arrowUp',
      color: isHigh ? 'rgba(248, 113, 113, 0.95)' : 'rgba(34, 197, 94, 0.95)',
      text: isHigh
        ? `swing high ${formatAxisPrice(s.price)} ${token1Symbol}`
        : `swing low ${formatAxisPrice(s.price)} ${token1Symbol}`,
    };
  });
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

/**
 * (Re-)apply the data series + overlay price lines + swing markers
 * onto an EXISTING series (not a fresh chart). Removes any
 * previously created overlay lines, sets data, replaces markers,
 * and returns the new overlays. Used on data/range change so we
 * never call `createChart` twice on the same canvas (which
 * lightweight-charts rejects).
 *
 * Data path: daily candles (already bucketed by the
 * `HistoryAggregator`) → area-series points (one per day,
 * plotting each day's `close`) → `series.setData`. Swing markers
 * + price-line overlays operate on the daily candle scale.
 */
export function applyDataAndOverlays(
  series: ISeriesApi<'Area'>,
  input: IPriceChartInput,
  lw: ILightweightChartsModule,
  previous: IPriceLine[],
  markersPlugin: ISeriesMarkersPluginApi<UTCTimestamp>,
): IPriceLine[] {
  // Remove stale overlays.
  for (const line of previous) series.removePriceLine(line);

  const candles = candlesToOhlc(input.candles);
  series.setData(toLinePoints(input.candles));

  // Replace markers — empty array clears.
  const swings = findSwingPoints(input.candles, input.swingWindow ?? 3);
  const markers = buildSwingMarkers(swings, input.token1Symbol);
  markersPlugin.setMarkers(markers);

  const priceLines: IPriceLine[] = [];
  const range = input.strategyRange;
  if (range) {
    if (Number.isFinite(range.lowerPrice) && range.lowerPrice > 0) {
      priceLines.push(series.createPriceLine({
        price: range.lowerPrice,
        color: 'rgba(34, 197, 94, 1)',
        lineWidth: 3,
        lineStyle: lw.LineStyle.Solid,
        axisLabelVisible: true,
        title: `↓ ${formatAxisPrice(range.lowerPrice)}`,
      }));
    }
    if (Number.isFinite(range.upperPrice) && range.upperPrice > 0) {
      priceLines.push(series.createPriceLine({
        price: range.upperPrice,
        color: 'rgba(34, 197, 94, 1)',
        lineWidth: 3,
        lineStyle: lw.LineStyle.Solid,
        axisLabelVisible: true,
        title: `↑ ${formatAxisPrice(range.upperPrice)}`,
      }));
    }
  }

  // "now" line is the LAST candle's close — the latest close on
  // the daily scale, not the raw last snapshot, so the line stays
  // anchored to the visible price scale.
  const lastCandle = candles[candles.length - 1];
  if (lastCandle) {
    const now = lastCandle.close;
    if (Number.isFinite(now)) {
      priceLines.push(series.createPriceLine({
        price: now,
        color: 'rgba(248, 113, 113, 1)',
        lineWidth: 2,
        lineStyle: lw.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'now',
      }));
    }
  }

  return priceLines;
}

/**
 * Build the chart + candlestick series + marker plugin + apply
 * initial data + overlays. Pure — takes the injected module +
 * input + container and returns handles the component stores in
 * refs.
 */
export function buildPriceChart(
  input: IPriceChartInput,
  lw: ILightweightChartsModule,
  container: HTMLElement,
): IPriceChartHandles {
  // v5 API: chart.addSeries(AreaSeries, opts). The removed
  // v4 method `addAreaSeries` was a previous source of runtime
  // errors (we hit exactly that bug once); calling `addSeries`
  // with the SeriesDefinition object is the v5-correct shape.
  const chart = lw.createChart(container, {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: 'rgba(203, 213, 225, 0.9)',
      fontSize: 12,
    },
    grid: {
      vertLines: { color: 'rgba(148, 163, 184, 0.10)' },
      horzLines: { color: 'rgba(148, 163, 184, 0.10)' },
    },
    rightPriceScale: {
      // Higher-contrast border so the right gutter is visually
      // defined against the page background.
      borderColor: 'rgba(148, 163, 184, 0.55)',
      borderVisible: true,
      scaleMargins: { top: 0.10, bottom: 0.10 },
      autoScale: true,
      // Force the price labels onto their own high-contrast
      // color so they're legible on the dark background.
      textColor: 'rgba(226, 232, 240, 0.95)',
      // NOTE: `alignLabels: true` repositions tick labels INSIDE
      // the chart area at a fixed stride to prevent them from
      // overlapping. For sparse series (few price levels visible
      // at once) the algorithm can hide every label, leaving the
      // right gutter blank. Disabling it lets lightweight-charts
      // draw each natural tick label at its true y-coordinate —
      // visually messier on a dense series, but always legible.
      // We compensate by giving the scale a minimum width below.
      alignLabels: false,
    },
    timeScale: {
      borderColor: 'rgba(148, 163, 184, 0.2)',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 4,
    },
    crosshair: {
      vertLine: { color: 'rgba(148, 163, 184, 0.4)', labelBackgroundColor: 'rgba(51, 65, 85, 0.9)' },
      horzLine: { color: 'rgba(148, 163, 184, 0.4)', labelBackgroundColor: 'rgba(51, 65, 85, 0.9)' },
    },
  });

  // Force a minimum width on the right price scale so the price
  // labels always have room to render. Without `minimumWidth`,
  // lightweight-charts can collapse the scale to ~0px when the
  // host container is narrow and short — which makes the labels
  // invisible even though the chart itself renders fine. 60px is
  // enough for 4-digit prices at the default font size.
  chart.priceScale('right').applyOptions({
    minimumWidth: 60,
    // Draw the small horizontal tick marks on the scale even if
    // the host hasn't enabled them at the layout level.
    drawTicks: true,
  });

  const series = chart.addSeries(lw.AreaSeries, {
    // Color the area: top fades from accent, bottom is fully
    // transparent so the chart's dark backdrop shows through.
    topColor: 'rgba(56, 189, 248, 0.35)',
    bottomColor: 'rgba(56, 189, 248, 0.0)',
    lineColor: 'rgba(56, 189, 248, 1)',
    lineWidth: 2,
    relativeGradient: false,
    invertFilledArea: false,
    // Show the default "last value" badge on the right axis —
    // this gives the user a permanently-visible price number
    // on the y-axis.
    priceLineVisible: true,
    lastValueVisible: true,
  }) as ISeriesApi<'Area'>;

  // v5 markers plugin (replaces v4's `series.setMarkers`).
  const markers = lw.createSeriesMarkers(series, [], { zOrder: 'aboveSeries' });

  const priceLines = applyDataAndOverlays(series, input, lw, [], markers);

  return { chart, series, priceLines, markers };
}

/**
 * Build the crosshair tooltip text. Pure — a function of the hover
 * state, so it's unit-testable without a DOM. For an `AreaSeries`
 * the crosshair payload carries a single `value` per point, so we
 * render `<date> · <price> <token1> / <token0>`.
 */
export function formatCrosshair({
  time,
  price,
  token0Symbol,
  token1Symbol,
}: {
  time?: Time;
  price: number;
  token0Symbol: string;
  token1Symbol: string;
}): string {
  const dateStr = typeof time === 'number'
    ? new Date(time * 1000).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : String(time ?? '');
  return `${dateStr} · ${formatAxisPrice(price)} ${token1Symbol} / ${token0Symbol}`;
}

/**
 * Build the persistent top-left price badge. Shows the latest
 * daily bucket's close price in large text plus the strategy
 * range below it, so the user always sees the price even if the
 * y-axis labels happen to render at low contrast.
 *
 * "Latest" here means the last COLLAPSED daily bucket (since
 * the chart plots daily closes, not raw snapshots), so the badge
 * stays consistent with what the user sees on the line.
 */
export function buildPriceBadge({
  candles,
  strategyRange,
  token1Symbol,
  token0Symbol,
}: {
  candles: readonly IHistoryCandleDTO[];
  strategyRange: IPriceChartRange | null | undefined;
  token1Symbol: string;
  token0Symbol: string;
}): {
  lastPrice: string;
  lastTime: string;
  rangeLabel: string;
  pairLabel: string;
  swingHighLabel: string;
  swingLowLabel: string;
} {
  const ohlc = candlesToOhlc(candles);
  const last = ohlc[ohlc.length - 1];
  const lastPrice = last
    ? `${formatAxisPrice(last.close)} ${token1Symbol} / ${token0Symbol}`
    : `— ${token1Symbol} / ${token0Symbol}`;
  const lastTime = last
    ? new Date(last.time * 1000).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
      })
    : '';
  const rangeLabel = strategyRange
    ? `range: [${formatAxisPrice(strategyRange.lowerPrice)}, ${formatAxisPrice(strategyRange.upperPrice)}]`
    : '';

  // Surface the top-1 swing high / low prices in the badge so the
  // user sees them as text even when the in-chart markers are
  // cropped by the right gutter.
  const swings = findSwingPoints(candles, 3);
  const highest = swings
    .filter((s) => s.kind === 'high')
    .reduce<ISwingPoint | null>((best, s) => (best === null || s.price > best.price) ? s : best, null);
  const lowest = swings
    .filter((s) => s.kind === 'low')
    .reduce<ISwingPoint | null>((best, s) => (best === null || s.price < best.price) ? s : best, null);
  const swingHighLabel = highest
    ? `high ${formatAxisPrice(highest.price)}`
    : '';
  const swingLowLabel = lowest
    ? `low ${formatAxisPrice(lowest.price)}`
    : '';

  return {
    lastPrice,
    lastTime,
    rangeLabel,
    pairLabel: `${token1Symbol} / ${token0Symbol}`,
    swingHighLabel,
    swingLowLabel,
  };
}
