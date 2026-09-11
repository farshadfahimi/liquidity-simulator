<script setup lang="ts">

// app/components/SimulationTab.vue
//
// "Simulation" tab content. Extracted from
// `app/pages/pool/[pool].vue` in Phase 9. Pure presentational.
//
// Renders a run-form (tick range, principal, numeraire token)
// on top and a results section below. The results section is
// driven by `result: IPositionSimulationDTO | null` from the page
// (the page calls `simulatePosition.execute(...)` and forwards
// the DTO). When `result` is non-null we render every block the
// use case actually populated:
//
//   - Quote & Deposit (always present).
//   - Future-price scenario (when the use case was given a target).
//   - Historical replay (when given history, ≥ 2 snapshots).
//   - Monte Carlo (when given μ/σ/paths).
//
// All formatters come from `app/utils/formatDtos.ts` (Nuxt
// auto-import). Per the Phase 9 §6.10 rules this component stays
// presentational: it doesn't call use cases, doesn't fetch, doesn't
// own any state beyond its props.

import type { IPositionSimulationDTO } from '@core/application/dtos';

interface IProps {
  tickLower: number;
  tickUpper: number;
  principal: string;
  numeraire: 'token0' | 'token1';
  loading: boolean;
  error: string | null;
  result: IPositionSimulationDTO | null;

  /** Token metadata from the page's analysis DTO. Used to format raw amounts. */
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
}

const props = defineProps<IProps>();

const emit = defineEmits<{
  (e: 'update:tickLower', value: number): void;
  (e: 'update:tickUpper', value: number): void;
  (e: 'update:principal', value: string): void;
  (e: 'update:numeraire', value: 'token0' | 'token1'): void;
  (e: 'run'): void;
}>();

const numeraireOptions = [
  { value: 'token0', label: 'token0' },
  { value: 'token1', label: 'token1' },
];

// Resolve which token (and its decimals) is the numeraire. Used
// when rendering the DTO so the UI doesn't have to repeat the
// ternary everywhere.
const numeraireSymbol = (): string => props.numeraire === 'token0' ? props.token0Symbol : props.token1Symbol;
const numeraireDecimals = (): number => props.numeraire === 'token0' ? props.token0Decimals : props.token1Decimals;

// One row of "label / value" inside a card. The `<dl>` / `<dt>` /
// `<dd>` pattern in PoolDetailsTab keeps the visual rhythm of
// the rest of the page.
function row(label: string, value: string): { label: string; value: string } {
  return { label, value };
}

// ---- result sections -----------------------------------------------------
// Each helper returns the rows we want to render for a given
// block, or `null` if the block wasn't populated. The template
// iterates over the result of `resultRows(...)` and short-circuits
// on `null` so we don't render empty cards.

function quoteRows(result: IPositionSimulationDTO) {
  return [
    row('liquidity', result.quote.liquidity.toString()),
    row(`amount ${props.token0Symbol}`, formatTokenAmount(result.quote.amount0, props.token0Decimals)),
    row(`amount ${props.token1Symbol}`, formatTokenAmount(result.quote.amount1, props.token1Decimals)),
  ];
}

function depositRows(result: IPositionSimulationDTO) {
  return [
    row(`deposit ${props.token0Symbol}`, formatTokenAmount(result.deposit.amount0, props.token0Decimals)),
    row(`deposit ${props.token1Symbol}`, formatTokenAmount(result.deposit.amount1, props.token1Decimals)),
    row(`notional (${numeraireSymbol()})`, formatTokenAmount(result.deposit.notionalInNumeraire, numeraireDecimals())),
  ];
}

function futurePriceRows(result: IPositionSimulationDTO) {
  if (!result.futurePrice) return null;
  return [
    row('terminal price', formatPriceShort(result.futurePrice.terminalPrice, result.futurePrice.terminalPriceDecimals)),
    row(`terminal value (${numeraireSymbol()})`, formatTokenAmount(result.futurePrice.terminalValueInNumeraire, numeraireDecimals())),
    row('IL (terminal)', formatIL(result.futurePrice.terminalIl)),
    row('horizon', formatSeconds(result.futurePrice.horizonSeconds)),
  ];
}

function historicalRows(result: IPositionSimulationDTO) {
  if (!result.historical) return null;
  const h = result.historical;
  return [
    row('APR', formatAPR(h.apr)),
    row('mean IL', formatIL(h.meanIl)),
    row('min IL', formatIL(h.minIl)),
    row('max IL', formatIL(h.maxIl)),
    row('final IL', formatIL(h.finalIl)),
    row('time in range', `${(Number(h.timeInRangeFraction) / 1e18 * 100).toFixed(2)}%`),
    row('max drawdown', formatIL(h.maxDrawdown)),
    row(`total fees (${numeraireSymbol()})`, formatTokenAmount(h.totalFeesInNumeraire, numeraireDecimals())),
    row('replay window', formatSeconds(h.totalSeconds)),
    row('intervals', `${h.nIntervals} / ${h.nSnapshots} snapshots`),
  ];
}

function monteCarloRows(result: IPositionSimulationDTO) {
  if (!result.monteCarlo) return null;
  const m = result.monteCarlo;
  return [
    row('paths', `${m.nPaths}`),
    row('horizon', formatSeconds(m.horizonSeconds)),
    row(`terminal value mean (${numeraireSymbol()})`, formatTokenAmount(m.terminalValueMean, numeraireDecimals())),
    row('P05', formatTokenAmount(m.terminalValueP05, numeraireDecimals())),
    row('P50 (median)', formatTokenAmount(m.terminalValueP50, numeraireDecimals())),
    row('P95', formatTokenAmount(m.terminalValueP95, numeraireDecimals())),
    row('IL mean', formatIL(m.terminalIlMean)),
    row('IL P05', formatIL(m.terminalIlP05)),
    row('IL P50', formatIL(m.terminalIlP50)),
    row('IL P95', formatIL(m.terminalIlP95)),
    row('time in range', `${(Number(m.timeInRangeFraction) / 1e18 * 100).toFixed(2)}%`),
  ];
}
</script>

<template>
  <div class="space-y-4 mt-4">
    <!-- Run form ------------------------------------------------------ -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <UFormField label="tickLower" name="tickLower">
        <UInput
          :model-value="props.tickLower"
          type="number"
          @update:model-value="(v: number | string) => emit('update:tickLower', Number(v))"
        />
      </UFormField>
      <UFormField label="tickUpper" name="tickUpper">
        <UInput
          :model-value="props.tickUpper"
          type="number"
          @update:model-value="(v: number | string) => emit('update:tickUpper', Number(v))"
        />
      </UFormField>
      <UFormField
        label="principal (raw units, bigint)"
        name="principal"
      >
        <UInput
          :model-value="props.principal"
          @update:model-value="(v: string) => emit('update:principal', v)"
        />
      </UFormField>
      <UFormField label="numeraire" name="numeraire">
        <USelectMenu
          :model-value="props.numeraire"
          :items="numeraireOptions"
          value-key="value"
          @update:model-value="(v: 'token0' | 'token1') => emit('update:numeraire', v)"
        />
      </UFormField>
    </div>

    <UButton
      color="primary"
      :loading="props.loading"
      @click="emit('run')"
    >
      Run simulation
    </UButton>

    <UAlert
      v-if="props.error"
      color="error"
      variant="subtle"
      :title="props.error"
      icon="i-lucide-alert-circle"
    />

    <!-- Results ------------------------------------------------------- -->
    <template v-if="props.result">
      <div class="text-sm text-muted">
        Entry price:
        <span class="font-mono">{{ formatPriceShort(props.result.entryPrice, props.result.entryPriceDecimals) }}</span>
        · range
        <span class="font-mono">[{{ props.result.range.tickLower }}, {{ props.result.range.tickUpper }}]</span>
        · principal
        <span class="font-mono">{{ props.result.principalInNumeraire.toString() }}</span>
        ({{ props.result.numeraireToken }})
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UCard variant="subtle">
          <template #header>
            <h3 class="text-base font-medium">Quote</h3>
          </template>
          <dl class="space-y-2">
            <div v-for="r in quoteRows(props.result)" :key="r.label" class="flex justify-between gap-2">
              <dt class="text-muted">{{ r.label }}</dt>
              <dd class="font-mono text-right break-all">{{ r.value }}</dd>
            </div>
          </dl>
        </UCard>

        <UCard variant="subtle">
          <template #header>
            <h3 class="text-base font-medium">Deposit</h3>
          </template>
          <dl class="space-y-2">
            <div v-for="r in depositRows(props.result)" :key="r.label" class="flex justify-between gap-2">
              <dt class="text-muted">{{ r.label }}</dt>
              <dd class="font-mono text-right break-all">{{ r.value }}</dd>
            </div>
          </dl>
        </UCard>

        <UCard v-if="futurePriceRows(props.result)" variant="subtle" class="md:col-span-2">
          <template #header>
            <h3 class="text-base font-medium">Future price scenario</h3>
          </template>
          <dl class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div v-for="r in futurePriceRows(props.result)" :key="r.label">
              <dt class="text-muted text-sm">{{ r.label }}</dt>
              <dd class="font-mono">{{ r.value }}</dd>
            </div>
          </dl>
        </UCard>

        <UCard v-if="historicalRows(props.result)" variant="subtle" class="md:col-span-2">
          <template #header>
            <h3 class="text-base font-medium">Historical replay</h3>
          </template>
          <dl class="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div v-for="r in historicalRows(props.result)" :key="r.label">
              <dt class="text-muted text-sm">{{ r.label }}</dt>
              <dd class="font-mono">{{ r.value }}</dd>
            </div>
          </dl>
        </UCard>

        <UCard v-if="monteCarloRows(props.result)" variant="subtle" class="md:col-span-2">
          <template #header>
            <h3 class="text-base font-medium">Monte Carlo</h3>
          </template>
          <dl class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div v-for="r in monteCarloRows(props.result)" :key="r.label">
              <dt class="text-muted text-sm">{{ r.label }}</dt>
              <dd class="font-mono">{{ r.value }}</dd>
            </div>
          </dl>
        </UCard>
      </div>
    </template>
  </div>
</template>
