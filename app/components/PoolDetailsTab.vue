<script setup lang="ts">

// app/components/PoolDetailsTab.vue
//
// "Pool Details" tab content. Extracted from
// `app/pages/pool/[pool].vue` in Phase 9. Pure presentational:
// expects a fully-loaded `IPoolAnalysisDTO` (or `null` while
// loading).
//
// `formatAmountShort` is auto-imported from
// `app/core/shared/utils` (via the `@core/*` alias).
// `formatIL` / `formatAPR` / `formatVol` / etc. come from
// `app/utils/formatDtos.ts` (Nuxt auto-import).

import type { IPoolAnalysisDTO } from '@core/application/dtos';

interface IProps {
  analysis: IPoolAnalysisDTO | null;
  loading: boolean;
}

const props = defineProps<IProps>();

// Display helpers — see Phase 5 docs in AGENT.md §6.12
function fmtPct(v: bigint, scale: bigint) {
  return `${(Number(v) / Number(scale) * 100).toFixed(2)}%`;
}

function fmtPrice(v: bigint, decimals = 18) {
  return formatAmountShort(v, decimals, 6);
}
</script>

<template>
  <div class="space-y-4 mt-4">
    <div v-if="!props.analysis && !props.loading" class="text-muted">
      Pool metadata not yet available.
    </div>
    <div v-else-if="props.loading" class="text-muted">
      Fetching live pool state…
    </div>
    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <UCard variant="subtle">
        <template #header>
          <h3 class="text-base font-medium">Tokens</h3>
        </template>
        <dl class="space-y-2">
          <div class="flex justify-between">
            <dt class="text-muted">token0</dt>
            <dd class="font-mono text-xs">
              {{ props.analysis!.token0.symbol }} ({{ props.analysis!.token0.decimals }}d)
            </dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">address</dt>
            <dd class="font-mono text-xs break-all max-w-[260px]">
              {{ props.analysis!.token0.address }}
            </dd>
          </div>
          <div class="flex justify-between mt-3">
            <dt class="text-muted">token1</dt>
            <dd class="font-mono text-xs">
              {{ props.analysis!.token1.symbol }} ({{ props.analysis!.token1.decimals }}d)
            </dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">address</dt>
            <dd class="font-mono text-xs break-all max-w-[260px]">
              {{ props.analysis!.token1.address }}
            </dd>
          </div>
        </dl>
      </UCard>

      <UCard variant="subtle">
        <template #header>
          <h3 class="text-base font-medium">Live state</h3>
        </template>
        <dl class="space-y-2">
          <div class="flex justify-between">
            <dt class="text-muted">current tick</dt>
            <dd class="font-mono">{{ props.analysis!.currentTick }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">tick spacing</dt>
            <dd class="font-mono">{{ props.analysis!.tickSpacing }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">fee tier</dt>
            <dd class="font-mono">
              {{ props.analysis!.feeTier / 10000 }}%
            </dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">current price</dt>
            <dd class="font-mono text-xs">
              {{ fmtPrice(props.analysis!.currentPrice, props.analysis!.currentPriceDecimals) }}
            </dd>
          </div>
        </dl>
      </UCard>

      <UCard variant="subtle" class="md:col-span-2">
        <template #header>
          <h3 class="text-base font-medium">Analytics</h3>
        </template>
        <dl class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <dt class="text-muted text-sm">realized volatility (annual)</dt>
            <dd class="font-mono text-lg">
              {{ formatVol(props.analysis!.annualizedVolatility) }}
            </dd>
          </div>
          <div>
            <dt class="text-muted text-sm">cumulative return</dt>
            <dd class="font-mono text-lg">
              {{ ((Number(props.analysis!.cumulativeReturn) / 1e18 - 1) * 100).toFixed(2) }}%
            </dd>
          </div>
          <div>
            <dt class="text-muted text-sm">snapshots</dt>
            <dd class="font-mono text-lg">
              {{ props.analysis!.snapshotCount }}
            </dd>
          </div>
          <div>
            <dt class="text-muted text-sm">history window</dt>
            <dd class="font-mono text-lg">
              {{ Number(props.analysis!.historyWindowSeconds) }}s
            </dd>
          </div>
        </dl>
      </UCard>
    </div>
  </div>
</template>
