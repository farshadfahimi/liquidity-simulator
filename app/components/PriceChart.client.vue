<script setup lang="ts">

// app/components/PriceChart.client.vue
//
// Charting wrapper for the "Charts" pool-page tab, powered by
// TradingView's OPEN-SOURCE `lightweight-charts` library (the
// same engine Uniswap/DexScreener/DexTools use). Renders a
// STANDARD TIME-BASED AreaSeries chart of pool price vs. time,
// with three horizontal PRICE LINES overlaying the top-1
// strategy's lowerPrice / upperPrice and the current ("now")
// price, plus explicit "swing high" / "swing low" markers on
// the global extrema — so the user can read the exact range
// values straight off the y-axis AND see where the visible
// extremes are.
//
// `.client.vue` suffix is the Nuxt 4 convention for client-only
// components — lightweight-charts creates canvas/DOM and would
// otherwise break SSR. The ChartsTab already lives inside a
// `<ClientOnly>` block, but keeping the suffix belt-and-braces
// guarantees the import never runs server-side.
//
// This component delegates all chart construction to the pure,
// test-covered builder in `app/utils/priceChart.ts`. The heavy
// lifting there is mocked out in a Vitest unit test, so
// regressions like the v4→v5 API change (`addAreaSeries` was
// removed; v5 uses `chart.addSeries(SeriesDefinition, opts)`
// and `createSeriesMarkers` replaced `series.setMarkers`) are
// caught before they reach the browser.
//
// Chart primitive: AreaSeries (time-based, no candles).
//
// The use case fetches roughly one snapshot per day for the
// 14d/30d/90d UI selectors. Those snapshots are aggregated into
// daily OHLC candles by the `HistoryAggregator` (timeframe `'1d'`)
// before reaching this component — so the x-axis lines up to UTC
// midnight and the swing markers are driven from each day's
// `high` / `low` (not from a client-side re-bucketing of raw
// snapshots).

import {
  createChart,
  LineStyle,
  AreaSeries,
  createSeriesMarkers,
} from 'lightweight-charts';
import type {
  IChartApi,
  ISeriesApi,
  IPriceLine,
  ISeriesMarkersPluginApi,
  UTCTimestamp,
  Time,
} from 'lightweight-charts';
import type { IHistoryCandleDTO } from '@core/application/dtos';
import {
  applyDataAndOverlays,
  buildPriceBadge,
  buildPriceChart,
  formatCrosshair,
} from '~/utils/priceChart';

interface IProps {
  /** Daily OHLC candles (from `HistoryAggregator`, timeframe `'1d'`). */
  candles: readonly IHistoryCandleDTO[];
  /**
   * Top-1 strategy range to overlay (price band). `lowerPrice` /
   * `upperPrice` are `null` when the band is wider than the
   * displayable price scale (e.g. a full V3 span) — the chart
   * then skips drawing the line instead of overlaying an
   * off-screen price.
   */
  strategyRange?: {
    strategyName: string;
    lowerPrice: number | null;
    upperPrice: number | null;
    score: number;
    expectedApr: number;
  } | null;
  /** Token1 symbol for y-axis title. */
  token1Symbol: string;
  /** Token0 symbol — used for the chart title. */
  token0Symbol: string;
  /** Title of the chart (e.g. "ETH / USDC — 14-day history"). */
  title: string;
  /** Marker color when the series is synthetic (vs on-chain). */
  synthetic?: boolean;
  /** Window size for swing detection (default 3). Set to 0 to disable. */
  swingWindow?: number;
}

const props = withDefaults(defineProps<IProps>(), {
  swingWindow: 4,
});

// --- Refs for the imperative chart instance + the series we
// --- create price lines against. These live entirely client-side.
const containerRef = ref<HTMLElement | null>(null);
const tooltipRef = ref<HTMLElement | null>(null);

const chart = shallowRef<IChartApi | null>(null);
const series = shallowRef<ISeriesApi<'Area'> | null>(null);
const markersPlugin = shallowRef<ISeriesMarkersPluginApi<UTCTimestamp> | null>(null);
// Price lines we've created on the series; we remove them before
// re-applying so stale overlays don't stack when data/range change.
const overlayLines = shallowRef<IPriceLine[]>([]);

// Always-visible price badge in the top-left of the chart.
// Built off the same inputs as the chart itself so the badge
// value matches the y-axis data range.
const badge = computed(() => buildPriceBadge({
  candles: props.candles,
  strategyRange: props.strategyRange ?? null,
  token1Symbol: props.token1Symbol,
  token0Symbol: props.token0Symbol,
}));

const lw = { createChart, LineStyle, AreaSeries, createSeriesMarkers };

onMounted(() => {
  if (!containerRef.value) return;

  const handles = buildPriceChart(
    {
      candles: props.candles,
      strategyRange: props.strategyRange ?? null,
      token0Symbol: props.token0Symbol,
      token1Symbol: props.token1Symbol,
      synthetic: props.synthetic,
      swingWindow: props.swingWindow,
    },
    lw,
    containerRef.value,
  );

  chart.value = handles.chart;
  series.value = handles.series;
  markersPlugin.value = handles.markers;
  overlayLines.value = handles.priceLines;

  handles.chart.timeScale().fitContent();

  // Crosshair -> simple HTML tooltip overlay.
  handles.chart.subscribeCrosshairMove(handleCrosshair);
});

function handleCrosshair(param: {
  time?: Time;
  seriesData: Map<unknown, unknown>;
  point?: { x: number; y: number } | null;
}) {
  const tooltipEl = tooltipRef.value;
  const areaSeries = series.value;
  if (!tooltipEl || !areaSeries) return;

  // v5 AreaSeries: seriesData.get(series) returns a single-value
  // `{ value }` payload when the crosshair hovers a point.
  const data = param.seriesData.get(areaSeries) as { value?: number } | undefined;
  const price = typeof data?.value === 'number' ? data.value : NaN;
  if (!param.point || !Number.isFinite(price)) {
    tooltipEl.style.display = 'none';
    return;
  }

  const text = formatCrosshair({
    time: param.time,
    price,
    token0Symbol: props.token0Symbol,
    token1Symbol: props.token1Symbol,
  });

  tooltipEl.style.display = 'block';
  tooltipEl.style.left = `${param.point.x + 12}px`;
  tooltipEl.style.top = `${param.point.y - 8}px`;
  tooltipEl.textContent = text;
}

// Re-apply data + overlays + markers whenever candles/range/window change.
//
// Why we accept the watched tuple as the callback argument:
// The source getter `() => [props.candles, ...]` already does the
// reactive read; Vue passes the resolved tuple to the callback so
// we never need to touch `props.x` again. Reading `props.x` from
// inside the watcher callback defeats Vue's getter-based change
// detection AND forces the proxy to resolve on every reactive
// fire, even for fields the watcher doesn't care about. The tuple
// argument is also what `deep: true` triggers on correctly.
watch(
  () =>
    [
      props.candles,
      props.strategyRange,
      props.swingWindow,
      props.synthetic,
      props.token0Symbol,
      props.token1Symbol,
    ] as const,
  ([nextCandles, nextRange, nextWindow, nextSynthetic, nextToken0, nextToken1]) => {
    const areaSeries = series.value;
    const plugin = markersPlugin.value;
    if (!areaSeries || !plugin) return;

    const newLines = applyDataAndOverlays(
      areaSeries,
      {
        candles: nextCandles,
        strategyRange: nextRange ?? null,
        token0Symbol: nextToken0,
        token1Symbol: nextToken1,
        synthetic: nextSynthetic,
        swingWindow: nextWindow,
      },
      lw,
      overlayLines.value,
      plugin,
    );
    overlayLines.value = newLines;
    chart.value?.timeScale().fitContent();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  const chartInstance = chart.value;
  if (chartInstance) {
    chartInstance.remove();
    chart.value = null;
    series.value = null;
    markersPlugin.value = null;
  }
});
</script>

<template>
  <!--
    The chart container gets its own opaque dark surface so the
    light-slate y-axis labels and grid lines stay legible regardless
    of the host card/page background (e.g. Nuxt UI's default
    `<UCard>` uses a light `bg-default`, which would otherwise make
    the price-axis labels invisible). The canvas itself stays
    transparent so the dark backdrop shows through.
  -->
  <div class="relative h-80 w-full rounded-md bg-slate-900 ring-1 ring-slate-700/60">
    <!-- Explicit width/height on the lightweight-charts container
         so the price-scale gutter is guaranteed to exist and the
         right-axis labels render at their natural width. -->
    <div ref="containerRef" class="h-full w-full" />
    <!-- Persistent price badge (top-left). Shows the latest price,
         the strategy range, and the swing high/low so the user
         always sees the values even if the in-chart markers are
         clipped by the gutter. -->
    <div
      class="pointer-events-none absolute left-2 top-2 z-10 max-w-[60%] rounded-md bg-slate-900/85 px-3 py-2 text-slate-100 shadow-lg ring-1 ring-slate-700/60"
    >
      <div class="flex items-baseline gap-2">
        <span class="font-mono text-base font-semibold leading-none">
          {{ badge.lastPrice }}
        </span>
        <span class="text-[10px] uppercase tracking-wide text-slate-400">
          latest
        </span>
      </div>
      <div v-if="badge.lastTime" class="mt-1 text-[10px] text-slate-400">
        {{ badge.lastTime }}
      </div>
      <div
        v-if="badge.rangeLabel"
        class="mt-1 font-mono text-[11px] leading-none text-emerald-400"
      >
        {{ badge.rangeLabel }}
      </div>
      <div
        v-if="badge.swingHighLabel || badge.swingLowLabel"
        class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] leading-none"
      >
        <span v-if="badge.swingHighLabel" class="text-red-400">↓ {{ badge.swingHighLabel }}</span>
        <span v-if="badge.swingLowLabel" class="text-emerald-400">↑ {{ badge.swingLowLabel }}</span>
      </div>
    </div>
    <!--
      Right-axis unit label ("Price (USDC / TKN0)").
      lightweight-charts doesn't expose a native axis-title option
      for price scales, so we render one as a positioned overlay.
      Positioning notes:
        - right-1 (8px) lands inside the 60px minimumWidth gutter
          we set on the right price scale, beside the tick labels
          instead of overlapping them.
        - top-12 (48px) places it BELOW the lightweight-charts
          "lastValueVisible" badge so the two never collide.
        - vertical writing-mode + 180° rotation reads bottom-up,
          matching how TradingView / most charting libs print the
          y-axis unit (e.g. "USD" running upward along the right
          gutter).
        - tracking-widest + uppercase gives the small text room to
          breathe so the unit feels like an axis label, not a tag.
        - pointer-events-none so it never intercepts the crosshair.
    -->
    <div
      class="pointer-events-none absolute right-1 top-12 z-10 select-none text-[10px] font-medium uppercase tracking-widest text-slate-400/85"
      style="writing-mode: vertical-rl; transform: rotate(180deg);"
      :aria-label="`Price axis unit: ${token1Symbol} per ${token0Symbol}`"
    >
      Price ({{ token1Symbol }}&nbsp;/&nbsp;{{ token0Symbol }})
    </div>
    <!-- Crosshair tooltip overlay -->
    <div
      ref="tooltipRef"
      class="pointer-events-none fixed z-10 hidden rounded bg-slate-800/90 px-2 py-1 text-xs text-slate-200"
    />
  </div>
</template>
