<script setup lang="ts">

// app/pages/pool/[pool].vue
//
// Pool detail page. In Phase 9 the inline tab content was
// extracted into `app/components/Pool*.vue`; this page now
// owns only the data-fetching lifecycle, the route-driven
// inputs, and the tab orchestration.

import type { TAddress } from '@core/shared/types';
import { Pool } from '@core/domains/pool';
import type { IPoolAnalysisDTO, IRecommendationDTO, IPositionSimulationDTO } from '@core/application/dtos';

definePageMeta({
  layout: 'default',
});

const route = useRoute();
const router = useRouter();

const { useCases } = useCoreServices();
const session = useSessionState();

// -----------------------------------------------------------------
// Route inputs (the only entry points — values come from the
// query string on direct URL access, with safe fallbacks for
// legacy URLs that omit `protocolId`).
// -----------------------------------------------------------------
const poolAddress = computed(() => String(route.params.pool ?? ''));
const chainId = computed<number>(() => {
  const fromQuery = Number(route.query.chainId);
  return Number.isFinite(fromQuery) ? fromQuery : (session.lastChainId.value ?? 1);
});
const protocolId = computed<string>(() => {
  const raw = route.query.protocolId;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  const stored = session.lastProtocolId.value;
  if (stored && ADAPTER_REGISTRY[chainId.value]?.some((a) => a.protocolId === stored)) {
    return stored;
  }
  return ADAPTER_REGISTRY[chainId.value]?.[0]?.protocolId ?? 'uniswap-v3';
});
const feeTier = computed<number>(() => Number(route.query.fee ?? 500));

// -----------------------------------------------------------------
// Live analysis (AnalyzePoolUseCase)
// -----------------------------------------------------------------
const analysis = ref<IPoolAnalysisDTO | null>(null);
const isLoadingAnalysis = ref(false);
const analysisError = ref<string | null>(null);

async function loadAnalysis() {
  if (!poolAddress.value || !chainId.value) return;
  if (!useCases) {
    analysisError.value = 'Core services not ready';
    return;
  }
  isLoadingAnalysis.value = true;
  analysisError.value = null;
  try {
    const { analyzePool } = useCases();
    const data = await analyzePool.execute({
      pool: poolAddress.value as TAddress,
      chainId: chainId.value,
      protocolId: protocolId.value,
    });
    analysis.value = data;
  }
  catch (err) {
    analysisError.value = err instanceof Error ? err.message : String(err);
  }
  finally {
    isLoadingAnalysis.value = false;
  }
}

// -----------------------------------------------------------------
// Recommendation (CompareStrategiesUseCase)
// -----------------------------------------------------------------
const recommendation = ref<IRecommendationDTO | null>(null);
const isLoadingRecommendation = ref(false);
const recommendationError = ref<string | null>(null);

async function loadRecommendation() {
  if (!poolAddress.value || !chainId.value) return;
  if (!useCases || !analysis.value) return;

  isLoadingRecommendation.value = true;
  recommendationError.value = null;
  try {
    const { adapterForChain } = useAdapters();
    const adapter = adapterForChain(chainId.value, protocolId.value);
    if (!adapter) {
      recommendationError.value = `No adapter for chain ${chainId.value} (${protocolId.value})`;
      return;
    }
    const state = await adapter.getPoolState(poolAddress.value as TAddress);
    const aggregate = new Pool(state, chainId.value);

    const { compareStrategies } = useCases();
    const result = compareStrategies.execute({
      pool: aggregate,
      protocolId: protocolId.value,
      expectedApr: 300_000_000_000_000_000n, // 30%
      annualizedVolatility: 500_000_000_000_000_000n, // 50%
    });
    recommendation.value = result;
  }
  catch (err) {
    recommendationError.value = err instanceof Error ? err.message : String(err);
  }
  finally {
    isLoadingRecommendation.value = false;
  }
}

// -----------------------------------------------------------------
// Simulation (SimulatePositionUseCase)
// -----------------------------------------------------------------
const tickLower = ref<number>(-2000);
const tickUpper = ref<number>(2000);
const principal = ref<string>('10000');
const numeraire = ref<'token0' | 'token1'>('token1');

watch(analysis, (a) => {
  if (a) {
    tickLower.value = a.currentTick - 2000;
    tickUpper.value = a.currentTick + 2000;
  }
});

const simulation = ref<IPositionSimulationDTO | null>(null);
const isSimulating = ref(false);
const simulationError = ref<string | null>(null);

async function runSimulation() {
  simulationError.value = null;
  if (!useCases) {
    simulationError.value = 'Core services not ready';
    return;
  }
  isSimulating.value = true;
  try {
    const { simulatePosition } = useCases();
    const principalBig = BigInt(principal.value || '0');

    // `simulatePosition` sizes the position via `token0Amount` (raw
    // units of token0). The form's `principal` is in *numeraire* raw
    // units, so we convert at the current pool price. If the analysis
    // hasn't loaded yet we pass 0n; the historical / Monte Carlo
    // blocks still use `principalInNumeraire` directly so they're
    // unaffected.
    let token0Amount = 0n;
    if (principalBig > 0n && analysis.value) {
      const cp = analysis.value.currentPrice;
      const t0Dec = analysis.value.token0.decimals;
      if (numeraire.value === 'token0') {
        token0Amount = principalBig;
      }
      else if (cp > 0n) {
        // price is `token1 per token0` at `currentPriceDecimals`.
        // We want `token0` raw units for a given `token1` notional.
        //   token0_raw = principal_token1_raw * (1 / price)
        //              = principal * 10^t0Dec / price
        token0Amount = (principalBig * 10n ** BigInt(t0Dec)) / cp;
      }
    }

    const result = await simulatePosition.execute({
      pool: poolAddress.value as TAddress,
      chainId: chainId.value,
      protocolId: protocolId.value,
      range: { tickLower: tickLower.value, tickUpper: tickUpper.value },
      principalInNumeraire: principalBig,
      numeraireToken: numeraire.value,
      token0Amount,
    });
    simulation.value = result;
  }
  catch (err) {
    simulationError.value = err instanceof Error ? err.message : String(err);
  }
  finally {
    isSimulating.value = false;
  }
}

// -----------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------
// When the user navigates between pool pages, the page component
// is reused and `selectedTab` is preserved. That used to put the
// details tab in `present=false` state at mount, which Reka UI's
// <Presence> wrapper mishandled under `unmountOnHide: true` and
// threw "Unhandled error during execution of watcher callback".
// Resetting to 'details' on each new pool address keeps the
// initial tab predictable.
watch(poolAddress, () => {
  selectedTab.value = 'details';
  recommendation.value = null;
  simulation.value = null;
  analysisError.value = null;
  recommendationError.value = null;
  simulationError.value = null;
});

onMounted(async () => {
  await loadAnalysis();
  if (analysis.value) {
    await loadRecommendation();
  }
});

// -----------------------------------------------------------------
// Display + tabs
// -----------------------------------------------------------------
const tabs = [
  { value: 'details', label: 'Pool Details', icon: 'i-lucide-info' },
  { value: 'recommendation', label: 'Recommendation', icon: 'i-lucide-target' },
  { value: 'simulation', label: 'Simulation', icon: 'i-lucide-zap' },
  { value: 'strategies', label: 'Strategies', icon: 'i-lucide-bar-chart-2' },
];

// Map tab value -> component. We use a dynamic <component :is>
// rather than a v-if chain inside UTabs' #content slot because
// the chain compiles to a comment-vnode fragment which interacts
// badly with Reka UI's <Presence> wrapper under `unmountOnHide: true`
// when the active tab is not the first one (e.g. when navigating
// between pool pages while `selectedTab` is preserved).
//
// `resolveComponent` is used because the tab components are
// Nuxt-auto-imported (not present in the local script scope).
const tabComponents: Record<string, ReturnType<typeof resolveComponent>> = {
  details: resolveComponent('PoolDetailsTab'),
  recommendation: resolveComponent('RecommendationTab'),
  simulation: resolveComponent('SimulationTab'),
  strategies: resolveComponent('StrategiesTab'),
};

function getTabProps(value: string): Record<string, unknown> {
  switch (value) {
    case 'details':
      return { analysis: analysis.value, loading: isLoadingAnalysis.value };
    case 'recommendation':
      return {
        recommendation: recommendation.value,
        loading: isLoadingRecommendation.value,
        error: recommendationError.value,
      };
    case 'simulation':
      return {
        tickLower: tickLower.value,
        tickUpper: tickUpper.value,
        principal: principal.value,
        numeraire: numeraire.value,
        loading: isSimulating.value,
        error: simulationError.value,
        result: simulation.value,
        token0Symbol: analysis.value?.token0.symbol ?? 'token0',
        token1Symbol: analysis.value?.token1.symbol ?? 'token1',
        token0Decimals: analysis.value?.token0.decimals ?? 18,
        token1Decimals: analysis.value?.token1.decimals ?? 18,
      };
    case 'strategies':
      return { recommendation: recommendation.value };
    default:
      return {};
  }
}

const selectedTab = ref('details');

function goBack() {
  router.push('/');
}
</script>

<template>
  <UContainer class="py-8">
    <div class="max-w-5xl mx-auto space-y-6">
      <PoolHeader
        :pool-address="poolAddress"
        :chain-id="chainId"
        :fee-tier="feeTier"
        :protocol-id="protocolId"
        :title="analysis?.description ?? null"
        :loading="isLoadingAnalysis"
        @back="goBack"
      >
        <UAlert
          v-if="analysisError"
          color="error"
          variant="subtle"
          :title="analysisError"
          icon="i-lucide-alert-circle"
        />

        <ClientOnly>
          <UTabs v-model="selectedTab" :items="tabs" class="w-full">
            <template #content="{ item }">
              <component
                :is="tabComponents[item.value]"
                v-bind="getTabProps(item.value)"
                @rerun="loadRecommendation"
                @update:tick-lower="(v: number) => (tickLower = v)"
                @update:tick-upper="(v: number) => (tickUpper = v)"
                @update:principal="(v: string) => (principal = v)"
                @update:numeraire="(v: 'token0' | 'token1') => (numeraire = v)"
                @run="runSimulation"
              />
            </template>
          </UTabs>

          <template #fallback>
            <div class="py-8 text-center text-muted">
              Initializing LP analytics…
            </div>
          </template>
        </ClientOnly>
      </PoolHeader>
    </div>
  </UContainer>
</template>
