<script setup lang="ts">

// app/components/PoolDetailsTab.vue
//
// "Pool Details" tab content. Extracted from
// `app/pages/pool/[pool].vue` in Phase 9. Pure presentational:
// expects a fully-loaded `IPoolAnalysisDTO` (or `null` while
// loading).
//
// All formatting helpers (`formatAmountShort`, `formatIL`,
// `formatAPR`, `formatVol`, `formatUsd`, etc.) are auto-imported from
// `app/utils/formatDtos.ts`, which itself re-exports
// `formatAmountShort` / `formatUsd` from `@core/shared/utils` to
// make it available through the standard Nuxt auto-import scan of
// `app/utils/`.

import type { IPoolAnalysisDTO, IPoolTvlDTO } from '@core/application/dtos';
import type { TPoolLiquiditySource } from '@core/shared/types';

interface IProps {
  analysis: IPoolAnalysisDTO | null;
  loading: boolean;

  /** The TVL snapshot (slice 3) — `null` until it has loaded. */
  tvl?: IPoolTvlDTO | null;

  /** Whether the TVL snapshot is currently being fetched. */
  tvlLoading?: boolean;

  /** The last TVL error, if any. */
  tvlError?: string | null;
}

const props = defineProps<IProps>();

// Display helpers — see Phase 5 docs in AGENT.md §6.12
function fmtPct(v: bigint, scale: bigint) {
  return `${(Number(v) / Number(scale) * 100).toFixed(2)}%`;
}

function fmtPrice(v: bigint, decimals = 18) {
  return formatAmountShort(v, decimals, 6);
}

/**
 * Badge text for the provenance of the TVL number. The `source` field
 * is the single source of truth for "how good is this number"
 * (TVL-ROADMAP.md §8).
 */
const SOURCE_LABELS: Record<TPoolLiquiditySource, string> = {
  'defi-llama': 'defi-llama',
  'on-chain-estimates': 'estimate',
  'token-units': 'token units',
};

/** `0n` means "unknown" everywhere here — never render a fake zero. */
function usdOrDash(value: bigint): string {
  return value > 0n ? `$${formatUsd(value)}` : '—';
}

/** The fee APR is `0n` when unknown *or* when the outlier clamp fired. */
function aprOrDash(value: bigint): string {
  return value > 0n ? formatAPR(value) : '—';
}

/** The deposit's share of the pool, as a percentage. */
function shareOrDash(value: bigint): string {
  return value > 0n ? fmtPct(value, 1_000_000_000_000_000_000n) : '—';
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
          <h3 class="text-base font-medium">Liquidity &amp; TVL</h3>
        </template>

        <div v-if="props.tvlLoading" class="text-muted">
          Fetching liquidity data…
        </div>
        <div v-else-if="props.tvlError" class="text-muted">
          TVL unavailable: {{ props.tvlError }}
        </div>
        <div v-else-if="!props.tvl" class="text-muted">
          Liquidity data not available for this pool.
        </div>
        <template v-else>
          <dl class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <dt class="text-muted text-sm">TVL</dt>
              <dd class="font-mono text-lg">
                {{ usdOrDash(props.tvl.tvlUsd) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted text-sm">24h volume</dt>
              <dd class="font-mono text-lg">
                {{ usdOrDash(props.tvl.volume24hUsd) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted text-sm">implied fee APR</dt>
              <dd class="font-mono text-lg">
                {{ aprOrDash(props.tvl.feeApr) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted text-sm">your deposit share</dt>
              <dd class="font-mono text-lg">
                {{ shareOrDash(props.tvl.positionShare) }}
              </dd>
            </div>
          </dl>

          <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span class="text-muted">
              virtual reserves
              <span class="font-mono text-xs">
                {{ formatTokenAmount(props.tvl.amount0Raw, props.analysis!.token0.decimals) }}
                {{ props.analysis!.token0.symbol }}
                /
                {{ formatTokenAmount(props.tvl.amount1Raw, props.analysis!.token1.decimals) }}
                {{ props.analysis!.token1.symbol }}
              </span>
            </span>
            <span class="text-muted">
              source
              <span class="font-mono text-xs">
                {{ SOURCE_LABELS[props.tvl.source] }}
              </span>
            </span>
          </div>

          <p
            v-if="props.tvl.source === 'on-chain-estimates'"
            class="mt-2 text-xs text-muted"
          >
            On-chain estimate — counts only the liquidity active at the current tick.
          </p>
          <p
            v-else-if="props.tvl.source === 'token-units'"
            class="mt-2 text-xs text-muted"
          >
            No USD valuation available — showing the virtual reserves in token units only.
          </p>
        </template>
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
