<script setup lang="ts">

// app/pages/pool/[pool].vue
//
// Pool detail page. In Phase 9 the inline tab content was
// extracted into `app/components/Pool*.vue`; this page now
// owns only the data-fetching lifecycle, the route-driven
// inputs, and the tab orchestration.

import type { TAddress } from '@core/shared/types';
import { Pool } from '@core/domains/pool';
import type { IPoolAnalysisDTO, IRecommendationDTO } from '@core/application/dtos';

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

const simulation = ref<unknown>(null);
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
    const result = await simulatePosition.execute({
      pool: poolAddress.value as TAddress,
      chainId: chainId.value,
      protocolId: protocolId.value,
      range: { tickLower: tickLower.value, tickUpper: tickUpper.value },
      principalInNumeraire: principalBig,
      numeraireToken: numeraire.value,
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
              <PoolDetailsTab
                v-if="item.value === 'details'"
                :analysis="analysis"
                :loading="isLoadingAnalysis"
              />
              <RecommendationTab
                v-else-if="item.value === 'recommendation'"
                :recommendation="recommendation"
                :loading="isLoadingRecommendation"
                :error="recommendationError"
                @rerun="loadRecommendation"
              />
              <SimulationTab
                v-else-if="item.value === 'simulation'"
                :tick-lower="tickLower"
                :tick-upper="tickUpper"
                :principal="principal"
                :numeraire="numeraire"
                :loading="isSimulating"
                :error="simulationError"
                :has-result="simulation !== null"
                @update:tick-lower="(v: number) => (tickLower = v)"
                @update:tick-upper="(v: number) => (tickUpper = v)"
                @update:principal="(v: string) => (principal = v)"
                @update:numeraire="(v: 'token0' | 'token1') => (numeraire = v)"
                @run="runSimulation"
              />
              <StrategiesTab
                v-else-if="item.value === 'strategies'"
                :recommendation="recommendation"
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
