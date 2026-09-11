<script setup lang="ts">

// app/components/StrategiesTab.vue
//
// "Strategies" tab content. Extracted from
// `app/pages/pool/[pool].vue` in Phase 9. Pure presentational:
// renders a card per recommendation row from the Phase 6
// recommendation engine.
//
// `formatAPR` / `formatIL` come from `app/utils/formatDtos.ts`
// (Nuxt auto-import).

import type { IRecommendationDTO } from '@core/application/dtos';

interface IProps {
  recommendation: IRecommendationDTO | null;
}

const props = defineProps<IProps>();
</script>

<template>
  <div class="space-y-4 mt-4">
    <p class="text-muted">
      Per-strategy metrics as derived by the recommendation engine.
    </p>
    <div
      v-if="props.recommendation && props.recommendation.recommendations.length > 0"
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <UCard
        v-for="r in props.recommendation.recommendations"
        :key="r.id"
        variant="subtle"
      >
        <template #header>
          <h3 class="text-base font-medium">{{ r.strategyName }}</h3>
        </template>
        <dl class="space-y-2 text-sm">
          <div class="flex justify-between">
            <dt class="text-muted">range</dt>
            <dd class="font-mono">[{{ r.tickLower }}, {{ r.tickUpper }}]</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">score</dt>
            <dd class="font-mono">{{ (Number(r.score) / 1e18).toFixed(4) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">expected APR</dt>
            <dd class="font-mono">{{ formatAPR(r.expectedApr) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">IL</dt>
            <dd class="font-mono">{{ formatIL(r.ilAtCurrentPrice) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">capital efficiency</dt>
            <dd class="font-mono">{{ (Number(r.capitalEfficiency) / 1e18).toFixed(2) }}×</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">in range</dt>
            <dd>{{ r.currentlyInRange ? 'yes' : 'no' }}</dd>
          </div>
        </dl>
      </UCard>
    </div>
    <UAlert
      v-else
      color="neutral"
      variant="subtle"
      title="Run the Recommendation tab to populate this view."
      icon="i-lucide-info"
    />
  </div>
</template>
