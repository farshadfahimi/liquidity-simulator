<script setup lang="ts">

// app/components/ChartsTab.vue
//
// "Charts" tab content. Renders the price-history line chart
// for the current pool and overlays the top-1 strategy's
// recommended entry zone so the user can see "where to enter"
// visually.
//
// The tab orchestrates the fetch itself: it calls the
// `getPoolHistory` use case on mount, derives the top-1
// strategy from the recommendation DTO already loaded by the
// page, and passes the result to `<PriceChart>`.

import { computed, onMounted, ref, watch } from 'vue';
import type {
  IPoolHistoryDTO,
  IRecommendationDTO,
  IHistorySnapshotDTO,
} from '@core/application/dtos';
import { tickToPrice } from '@core/math';
import { useCoreServices } from '~/composables/useCoreServices';

interface IProps {
  pool: string;
  chainId: number;
  protocolId: string;
  analysis: { token0: { symbol: string; decimals: number }; token1: { symbol: string; decimals: number } } | null;
  recommendation: IRecommendationDTO | null;
}

const props = defineProps<IProps>();

const { useCases } = useCoreServices();

const history = ref<IPoolHistoryDTO | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);

// -----------------------------------------------------------------
// Top-1 strategy
// -----------------------------------------------------------------
//
// `recommendation.recommendations` is already sorted by score
// descending (per the DTO doc), so the first element is the
// top-1. We convert its tickLower / tickUpper to a price band
// using `tickToPrice` so the chart can overlay a box annotation.
const topStrategy = computed(() => {
  const top = props.recommendation?.recommendations?.[0] ?? null;
  if (!top || !props.analysis) return null;
  const t0d = props.analysis.token0.decimals;
  const t1d = props.analysis.token1.decimals;
  const lower = tickToPrice(top.tickLower, t0d, t1d, 18);
  const upper = tickToPrice(top.tickUpper, t0d, t1d, 18);
  return {
    strategyName: top.strategyName,
    tickLower: top.tickLower,
    tickUpper: top.tickUpper,
    lowerPrice: Number(lower.value) / 1e18,
    upperPrice: Number(upper.value) / 1e18,
    score: Number(top.score) / 1e18,
    expectedApr: Number(top.expectedApr) / 1e18 * 100,
  };
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
    });
    history.value = result;
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
  finally {
    isLoading.value = false;
  }
}

onMounted(load);

// Re-fetch when the user switches pools.
watch(() => [props.pool, props.chainId, props.protocolId], load);

const snapshots = computed<readonly IHistorySnapshotDTO[]>(() => history.value?.snapshots ?? []);
const token0Symbol = computed(() => props.analysis?.token0.symbol ?? 'token0');
const token1Symbol = computed(() => props.analysis?.token1.symbol ?? 'token1');
</script>

<template>
  <div class="space-y-4 mt-4">
    <div class="flex flex-wrap items-center gap-3 text-sm text-muted">
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

      <div v-else-if="snapshots.length < 2" class="text-muted text-sm">
        Not enough snapshots to draw a chart.
      </div>

      <ClientOnly v-else>
        <PriceChart
          :snapshots="snapshots"
          :strategy-range="topStrategy"
          :token0-symbol="token0Symbol"
          :token1-symbol="token1Symbol"
          :title="chartTitle"
          :synthetic="history?.source === 'synthetic'"
        />
        <template #fallback>
          <div class="h-80 flex items-center justify-center text-muted">
            Loading chart…
          </div>
        </template>
      </ClientOnly>

      <template v-if="topStrategy" #footer>
        <div class="flex flex-wrap gap-4 text-sm">
          <div>
            <span class="text-muted">top strategy: </span>
            <span class="font-medium">{{ topStrategy.strategyName }}</span>
          </div>
          <div>
            <span class="text-muted">range: </span>
            <span class="font-mono">[{{ topStrategy.tickLower }}, {{ topStrategy.tickUpper }}]</span>
          </div>
          <div>
            <span class="text-muted">price band: </span>
            <span class="font-mono">
              [{{ topStrategy.lowerPrice.toFixed(6) }}, {{ topStrategy.upperPrice.toFixed(6) }}]
            </span>
          </div>
          <div>
            <span class="text-muted">score: </span>
            <span class="font-mono">{{ topStrategy.score.toFixed(4) }}</span>
          </div>
          <div>
            <span class="text-muted">expected APR: </span>
            <span class="font-mono">{{ topStrategy.expectedApr.toFixed(2) }}%</span>
          </div>
        </div>
      </template>
    </UCard>
  </div>
</template>
