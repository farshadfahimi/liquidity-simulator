<script setup lang="ts">

// app/components/ChartsTab.vue
//
// "Charts" tab content. Renders the price-history line chart
// for the current pool and overlays a strategy's recommended
// entry zone so the user can see "where to enter" visually.
//
// The tab orchestrates the fetch itself: it calls the
// `getPoolHistory` use case on mount, derives the strategy
// range from the recommendation DTO already loaded by the
// page, and passes the result to `<PriceChart>`.
//
// The user can pick WHICH strategy is overlaid (not just the
// top-1) from the "strategy" dropdown next to the history
// window selector. The selection is keyed by the
// recommendation's stable `id` (`"{strategyId}:{rangeDescriptor}"`)
// so it survives re-renders of the ranked list, and falls back
// to the top-1 whenever the stored id is no longer in the list
// (different pool, or a recomputed candidate set).

import { computed, onMounted, ref, watch } from 'vue';
import type {
  IPoolHistoryDTO,
  IPoolTvlHistoryDTO,
  IRecommendationDTO,
  IRecommendationEntryDTO,
  IHistoryCandleDTO,
} from '@core/application/dtos';
import { tickToPrice } from '@core/math';
import { useCoreServices } from '~/composables/useCoreServices';
import {
  HISTORY_WINDOW_DAYS,
  type THistoryWindowDays,
  useSessionState,
} from '~/composables/useSessionState';
import {
  buildStrategyOptions,
  selectStrategyEntry,
  strategyDisplayLabel,
} from '~/utils/strategySelection';
import { formatCompactUsd } from '~/utils/priceChart';
import { USD_DECIMALS } from '@core/shared/utils';

interface IProps {
  pool: string;
  chainId: number;
  protocolId: string;
  analysis: { token0: { symbol: string; decimals: number }; token1: { symbol: string; decimals: number } } | null;
  recommendation: IRecommendationDTO | null;
}

const props = defineProps<IProps>();

const { useCases } = useCoreServices();
const session = useSessionState();

const history = ref<IPoolHistoryDTO | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);

// TVL history (TVL roadmap slice 5) — the optional second pane.
// A failure here NEVER breaks the price chart: the pane simply
// doesn't show up.
const tvlHistory = ref<IPoolTvlHistoryDTO | null>(null);
const tvlError = ref<string | null>(null);

// Window selector state. Mirrored into session storage so the
// user's preferred horizon survives reloads. Driven by
// `HISTORY_WINDOW_DAYS` so the dropdown can never disagree with
// what the use case knows how to render.
const windowDays = ref<THistoryWindowDays>(session.historyWindowDays.value);
const windowOptions = HISTORY_WINDOW_DAYS.map((d) => ({ label: `${d} days`, value: d }));

// -----------------------------------------------------------------
// Strategy selection
// -----------------------------------------------------------------
//
// `recommendation.recommendations` is already sorted by score
// descending (per the DTO doc), so the first element is the
// top-1. We convert the SELECTED row's tickLower / tickUpper to
// a price band using `tickToPrice` so the chart can overlay a
// box annotation.
//
// Defensive: extreme ranges (e.g. a 1M-tick "full V2" span) can
// produce values that round to 0 at the lower bound and overflow
// the 1e18 scale at the upper bound. We expose those as `null`
// so the chart skips the line and the footer shows "—" instead
// of "0" and "2,019,718,696,938,839,600".
const PRICE_DISPLAY_CAP = 1e15; // anything above this is "essentially unbounded"
function toHumanPrice(price: { value: bigint; decimals: number }): number | null {
  const v = Number(price.value) / 10 ** price.decimals;
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v > PRICE_DISPLAY_CAP) return null;
  return v;
}

/**
 * Translate one ranked recommendation into the chart's
 * `strategyRange` shape (price band + display metrics).
 * Returns `null` when we lack the token decimals.
 */
function toStrategyRange(entry: IRecommendationEntryDTO | null) {
  if (!entry || !props.analysis) return null;
  const t0d = props.analysis.token0.decimals;
  const t1d = props.analysis.token1.decimals;
  const lower = tickToPrice(entry.tickLower, t0d, t1d, 18);
  const upper = tickToPrice(entry.tickUpper, t0d, t1d, 18);
  const lowerPrice = toHumanPrice(lower);
  const upperPrice = toHumanPrice(upper);
  return {
    strategyName: entry.strategyName,
    tickLower: entry.tickLower,
    tickUpper: entry.tickUpper,
    lowerPrice,
    upperPrice,
    hasFiniteBand: lowerPrice !== null && upperPrice !== null,
    score: Number(entry.score) / 1e18,
    expectedApr: Number(entry.expectedApr) / 1e18 * 100,
  };
}

/** The ranked rows from the recommendation DTO (score-sorted). */
const rankedStrategies = computed<readonly IRecommendationEntryDTO[]>(
  () => props.recommendation?.recommendations ?? [],
);

/**
 * The row the user picked. We store the recommendation's stable
 * `id` rather than an index: indices shift whenever the
 * candidate set is recomputed, ids don't.
 *
 * `null` (nothing picked yet) means "follow the top-1", and a
 * stale id (pool changed / different candidate set) also falls
 * back to the top-1 rather than rendering nothing.
 */
const selectedStrategyId = ref<string | null>(null);

const selectedEntry = computed<IRecommendationEntryDTO | null>(
  () => selectStrategyEntry(rankedStrategies.value, selectedStrategyId.value),
);

/** The range actually overlaid on the chart. */
const selectedStrategy = computed(() => toStrategyRange(selectedEntry.value));

/** Dropdown items — one per ranked recommendation. */
const strategyOptions = computed(
  () => buildStrategyOptions(rankedStrategies.value),
);

/** Label of the currently applied strategy (shown in the select). */
const selectedStrategyLabel = computed(
  () => strategyDisplayLabel(rankedStrategies.value, selectedEntry.value),
);

/** True when the applied strategy is the default top-1 pick. */
const isTopStrategySelected = computed(() => {
  const rows = rankedStrategies.value;
  const row = selectedEntry.value;
  return rows.length > 0 && !!row && rows[0]!.id === row.id;
});

const chartTitle = computed(() => {
  if (!props.analysis) return 'Price history';
  return `${props.analysis.token0.symbol} / ${props.analysis.token1.symbol} — price history`;
});

// -----------------------------------------------------------------
// Fetch
// -----------------------------------------------------------------

async function load() {
  if (!useCases) {
    error.value = 'Core services not ready';
    return;
  }
  if (!props.pool || !props.chainId) {
    error.value = 'Pool address or chain id missing';
    return;
  }
  isLoading.value = true;
  error.value = null;
  try {
    const { getPoolHistory } = useCases();
    const result = await getPoolHistory.execute({
      pool: props.pool as `0x${string}`,
      chainId: props.chainId,
      protocolId: props.protocolId,
      window: { kind: 'days', days: windowDays.value },
      withCandles: ['1d'],
    });
    history.value = result;
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  finally {
    isLoading.value = false;
  }

  // The TVL history is fetched separately: it is a nice-to-have
  // panel, so its failure must never hide the price chart.
  await loadTvlHistory();
}

/**
 * Load the TVL history for the second pane.
 *
 * The use case degrades gracefully (an untracked pool or an
 * unreachable provider yields an empty point list), so the only
 * thing we have to handle here is a thrown programming error.
 */
async function loadTvlHistory(): Promise<void> {
  if (!useCases) return;

  const { getPoolTvlHistory } = useCases();

  try {
    tvlHistory.value = await getPoolTvlHistory.execute({
      pool: props.pool as `0x${string}`,
      chainId: props.chainId,
      protocolId: props.protocolId,
    });
    tvlError.value = null;
  }
  catch (err) {
    tvlHistory.value = null;
    tvlError.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(load);

// Re-fetch when the user switches pools OR changes the time-window
// selector. The session-state write is a no-op when the value
// hasn't actually changed.
watch(() => [props.pool, props.chainId, props.protocolId], load);
watch(windowDays, (days) => {
  session.setHistoryWindowDays(days);
  load();
});

const snapshots = computed(() => history.value?.snapshots ?? []);
// Daily OHLC candles produced by the `HistoryAggregator` (the use
// case pre-aggregates the snapshot stream when `withCandles` is
// set). The chart plots these directly — no client-side re-bucketing.
const candles = computed<readonly IHistoryCandleDTO[]>(
  () => history.value?.candles?.['1d'] ?? [],
);
const token0Symbol = computed(() => props.analysis?.token0.symbol ?? 'token0');
const token1Symbol = computed(() => props.analysis?.token1.symbol ?? 'token1');

// -----------------------------------------------------------------
// TVL history (TVL roadmap slice 5)
// -----------------------------------------------------------------

/**
 * The TVL points handed to the chart. The chart clips them to the
 * price candles' own span so both series share one x-axis.
 */
const tvlPoints = computed(() => tvlHistory.value?.points ?? []);

/** True when the pool is tracked and a TVL pane is drawn. */
const hasTvl = computed(() => tvlPoints.value.length > 0);

/** The latest TVL reading, in plain dollars. */
const latestTvlUsd = computed<number | null>(() => {
  const points = tvlPoints.value;
  const last = points[points.length - 1];

  return last ? Number(last.tvlUsd) / 10 ** USD_DECIMALS : null;
});

/** Legend label for the TVL series, e.g. "$1.20M". */
const latestTvlLabel = computed(() =>
  latestTvlUsd.value === null ? '—' : formatCompactUsd(latestTvlUsd.value),
);

/**
 * Footer price-band formatter. We use Intl.NumberFormat with up
 * to 6 fraction digits and no scientific notation so the
 * user sees the actual price (e.g. "0.000342" instead of
 * "3.42e-4"). Mirrors `formatTooltipPrice` in PriceChart.
 */
const footerFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 6,
  useGrouping: true,
});
function formatFooterPrice(v: number | null): string {
  if (v === null) return '—';
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  if (Math.abs(v) >= 1) return footerFormatter.format(v);
  // Sub-1 prices get 6 fraction digits, then we strip trailing
  // zeros so "0.500000" → "0.5".
  return v.toFixed(6).replace(/0+$/, '');
}
</script>

<template>
  <div class="space-y-4 mt-4">
    <div class="flex flex-wrap items-center gap-3 text-sm text-muted">
      <USelectMenu
        :model-value="windowDays"
        :items="windowOptions"
        value-key="value"
        size="xs"
        :disabled="isLoading"
        aria-label="Chart history window"
        @update:model-value="(v: number) => windowDays = v as THistoryWindowDays"
      >
        <template #label>
          <UIcon name="i-lucide-calendar" class="size-3.5" />
          <span>{{ windowDays }} days</span>
        </template>
      </USelectMenu>
      <!--
        Strategy selector — the user picks which ranked strategy's
        entry band is overlaid on the chart. The top-1 is the
        default; picking another one re-draws the band in place
        (the chart removes the previous overlay lines before
        adding the new ones).
      -->
      <USelectMenu
        :model-value="selectedStrategyId ?? selectedEntry?.id ?? null"
        :items="strategyOptions"
        value-key="value"
        size="xs"
        :disabled="strategyOptions.length === 0"
        aria-label="Strategy to overlay on the chart"
        @update:model-value="(v: string) => selectedStrategyId = v"
      >
        <template #label>
          <UIcon name="i-lucide-target" class="size-3.5" />
          <span>{{ selectedStrategyLabel }}</span>
        </template>
      </USelectMenu>
      <span>
        {{ snapshots.length }} snapshots
        <span v-if="history?.source === 'synthetic'" class="ml-2 text-amber-500">
          (synthetic — {{ history.sourceDetail }})
        </span>
        <span v-else-if="history?.source === 'on-chain'" class="ml-2 text-emerald-500">
          (on-chain)
        </span>
      </span>
      <span v-if="history?.annualizedVolatility && history.annualizedVolatility > 0n" class="ml-4">
        σ ≈ {{ (Number(history.annualizedVolatility) / 1e18 * 100).toFixed(1) }}%/yr
      </span>
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-lucide-refresh-cw"
        :loading="isLoading"
        @click="load"
      >
        Refresh
      </UButton>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :title="error"
      icon="i-lucide-alert-circle"
    />

    <UCard v-else variant="subtle">
      <template #header>
        <h3 class="text-base font-medium">
          Price history + recommended entry zone
        </h3>
      </template>

      <div v-if="!props.analysis" class="text-muted text-sm">
        Waiting for pool analysis…
      </div>

      <div v-else-if="candles.length < 2" class="text-muted text-sm">
        Not enough candles to draw a chart.
      </div>

      <ClientOnly v-else>
        <PriceChart
          :candles="candles"
          :strategy-range="selectedStrategy"
          :token0-symbol="token0Symbol"
          :token1-symbol="token1Symbol"
          :title="chartTitle"
          :synthetic="history?.source === 'synthetic'"
          :tvl-points="tvlPoints"
        />
        <template #fallback>
          <div class="h-80 flex items-center justify-center text-muted">
            Loading chart…
          </div>
        </template>
      </ClientOnly>

      <!--
        Chart legend. The TVL entry only appears when the pool is
        tracked by the market-data provider (DefiLlama) — an
        untracked pool keeps the single-series chart it had before.
      -->
      <div class="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <div class="flex items-center gap-1.5">
          <span class="h-0.5 w-4 rounded-full bg-sky-400" />
          <span class="text-muted">Price</span>
        </div>
        <div v-if="hasTvl" class="flex items-center gap-1.5">
          <span class="h-0.5 w-4 rounded-full bg-violet-400" />
          <span class="text-muted">TVL (DefiLlama)</span>
          <span class="font-mono text-slate-200">{{ latestTvlLabel }}</span>
        </div>
        <span v-if="tvlError" class="text-amber-500">
          TVL unavailable ({{ tvlError }})
        </span>
      </div>

      <template v-if="selectedStrategy" #footer>
        <div class="flex flex-wrap gap-4 text-sm">
          <div>
            <span class="text-muted">{{ isTopStrategySelected ? 'top strategy' : 'strategy' }}: </span>
            <span class="font-medium">{{ selectedStrategy.strategyName }}</span>
            <span v-if="!isTopStrategySelected" class="ml-1 text-[10px] uppercase tracking-wide text-muted">
              (not top-1)
            </span>
          </div>
          <div>
            <span class="text-muted">range: </span>
            <span class="font-mono">[{{ selectedStrategy.tickLower }}, {{ selectedStrategy.tickUpper }}]</span>
          </div>
          <div>
            <span class="text-muted">price band: </span>
            <span v-if="selectedStrategy.hasFiniteBand" class="font-mono">
              [{{ formatFooterPrice(selectedStrategy.lowerPrice) }}, {{ formatFooterPrice(selectedStrategy.upperPrice) }}]
              <span class="text-muted">{{ token1Symbol }} / {{ token0Symbol }}</span>
            </span>
            <span v-else class="text-muted italic">
              full V3 range — outside displayable price scale
            </span>
          </div>
          <div>
            <span class="text-muted">score: </span>
            <span class="font-mono">{{ selectedStrategy.score.toFixed(4) }}</span>
          </div>
          <div>
            <span class="text-muted">expected APR: </span>
            <span class="font-mono">{{ selectedStrategy.expectedApr.toFixed(2) }}%</span>
          </div>
        </div>
      </template>
    </UCard>
  </div>
</template>
