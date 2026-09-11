<script setup lang="ts">

// app/components/PriceChart.client.vue
//
// Chart.js wrapper for the "Charts" pool-page tab. Renders a
// single line chart of pool price vs. timestamp with an
// annotation box for the top-1 strategy's price range.
//
// `.client.vue` suffix is the Nuxt 4 convention for client-only
// components — chart.js touches the DOM and would otherwise break
// SSR. The ChartsTab already lives inside a `<ClientOnly>` block
// (the whole pool page does), but keeping the `.client` suffix
// belt-and-braces guarantees the import doesn't run server-side
// even if a future refactor moves things around.
//
// The component is purely presentational: it accepts a series
// and an optional strategy range, builds the chart.js dataset
// + options imperatively, and tears down on unmount. No state
// lives outside the ref.

import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import type { ChartData, ChartOptions } from 'chart.js';
import type { IHistorySnapshotDTO } from '@core/application/dtos';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler,
  annotationPlugin,
);

interface IProps {
  snapshots: readonly IHistorySnapshotDTO[];
  /** Top-1 strategy range to overlay (price band). */
  strategyRange?: {
    strategyName: string;
    lowerPrice: number;
    upperPrice: number;
    score: number;
    expectedApr: number;
  } | null;
  /** Token1 symbol for y-axis title. */
  token1Symbol: string;
  /** Token0 symbol — used for the chart title. */
  token0Symbol: string;
  /** Title of the chart (e.g. "ETH / USDC — 60-block history"). */
  title: string;
  /** Marker color when the series is synthetic (vs on-chain). */
  synthetic?: boolean;
}

const props = defineProps<IProps>();

// Convert the bigint price series to numbers for chart.js
// (it has no bigint support). The chart only needs visual
// precision — tooltips format back to short strings.
const data = computed<ChartData<'line'>>(() => {
  const points = props.snapshots.map((s) => ({
    x: Number(s.timestamp) * 1000, // ms for chart.js time scale
    y: Number(s.price) / 10 ** s.priceDecimals,
  }));
  const yLabel = `${props.token0Symbol} (per ${props.token1Symbol})`;
  return {
    datasets: [
      {
        label: yLabel,
        data: points,
        borderColor: props.synthetic ? 'rgb(148, 163, 184)' : 'rgb(99, 102, 241)',
        backgroundColor: props.synthetic ? 'rgba(148, 163, 184, 0.15)' : 'rgba(99, 102, 241, 0.18)',
        borderWidth: 2,
        fill: true,
        tension: 0.25,
        pointRadius: points.length > 80 ? 0 : 3,
        pointHoverRadius: 5,
      },
    ],
  };
});

const options = computed<ChartOptions<'line'>>(() => {
  const showStrategyBox = !!props.strategyRange;

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: props.title,
        color: 'rgb(148, 163, 184)',
        font: { size: 13, weight: 'normal' },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const v = ctx.parsed.y;
            return `price: ${formatPrice(v)}`;
          },
        },
      },
      annotation: showStrategyBox
        ? {
            annotations: {
              strategyBox: {
                type: 'box' as const,
                yMin: props.strategyRange!.lowerPrice,
                yMax: props.strategyRange!.upperPrice,
                backgroundColor: 'rgba(34, 197, 94, 0.12)',
                borderColor: 'rgba(34, 197, 94, 0.6)',
                borderWidth: 1,
                label: {
                  display: true,
                  content: `${props.strategyRange!.strategyName} (${props.strategyRange!.expectedApr.toFixed(1)}% APR)`,
                  position: { x: 'center' as const, y: 'start' as const },
                  color: 'rgb(34, 197, 94)',
                  font: { size: 11, weight: 'bold' as const },
                  backgroundColor: 'rgba(20, 83, 45, 0.7)',
                },
              },
              currentPriceLine: {
                type: 'line' as const,
                yMin: props.snapshots.length
                  ? Number(props.snapshots[props.snapshots.length - 1]!.price)
                    / 10 ** props.snapshots[props.snapshots.length - 1]!.priceDecimals
                  : 0,
                yMax: props.snapshots.length
                  ? Number(props.snapshots[props.snapshots.length - 1]!.price)
                    / 10 ** props.snapshots[props.snapshots.length - 1]!.priceDecimals
                  : 0,
                borderColor: 'rgba(248, 113, 113, 0.8)',
                borderWidth: 1.5,
                borderDash: [4, 4],
                label: {
                  display: true,
                  content: 'now',
                  position: 'start',
                  color: 'rgb(248, 113, 113)',
                  backgroundColor: 'rgba(127, 29, 29, 0.7)',
                },
              },
            },
          }
        : {},
    },
    scales: {
      x: {
        type: 'time' as const,
        time: {
          unit: 'minute' as const,
          displayFormats: { minute: 'HH:mm' },
        },
        ticks: { color: 'rgb(148, 163, 184)' },
        grid: { color: 'rgba(148, 163, 184, 0.1)' },
      },
      y: {
        type: 'linear' as const,
        ticks: {
          color: 'rgb(148, 163, 184)',
          callback: (v) => formatPrice(Number(v)),
        },
        grid: { color: 'rgba(148, 163, 184, 0.1)' },
      },
    },
  };
});

/** Format a numeric price to a short human string for axis + tooltip. */
function formatPrice(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(4);
  if (Math.abs(v) >= 0.0001) return v.toFixed(6);
  return v.toExponential(2);
}
</script>

<template>
  <div class="h-80 w-full">
    <Line :data="data" :options="options" />
  </div>
</template>
