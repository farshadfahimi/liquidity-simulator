<script setup lang="ts">

// app/components/RecommendationTab.vue
//
// "Recommendation" tab content. Extracted from
// `app/pages/pool/[pool].vue` in Phase 9. Pure presentational.

import type { IRecommendationDTO } from '@core/application/dtos';

interface IProps {
  recommendation: IRecommendationDTO | null;
  loading: boolean;
  error: string | null;
}

const props = defineProps<IProps>();

defineEmits<{
  (e: 'rerun'): void;
}>();
</script>

<template>
  <div class="space-y-4 mt-4">
    <UAlert
      v-if="props.error"
      color="error"
      variant="subtle"
      :title="props.error"
      icon="i-lucide-alert-circle"
    />

    <UButton
      color="primary"
      variant="subtle"
      :loading="props.loading"
      @click="$emit('rerun')"
    >
      Re-run
    </UButton>

    <div v-if="props.recommendation" class="space-y-4">
      <div class="flex flex-wrap gap-2">
        <UBadge color="neutral" variant="subtle">
          candidates: {{ props.recommendation.nCandidates }}
        </UBadge>
        <UBadge color="primary" variant="subtle">
          ranked: {{ props.recommendation.nRecommendations }}
        </UBadge>
        <UBadge
          v-if="props.recommendation.nSkipped > 0"
          color="warning"
          variant="subtle"
        >
          skipped: {{ props.recommendation.nSkipped }}
        </UBadge>
      </div>

      <UTable
        :data="props.recommendation.recommendations"
        :columns="[
          { accessorKey: 'strategyName', header: 'Strategy' },
          { accessorKey: 'tickLower', header: 'tickLower' },
          { accessorKey: 'tickUpper', header: 'tickUpper' },
          { accessorKey: 'score', header: 'Score' },
          { accessorKey: 'expectedApr', header: 'APR' },
          { accessorKey: 'ilAtCurrentPrice', header: 'IL (range edge)' },
          { accessorKey: 'capitalEfficiency', header: 'CE' },
          { accessorKey: 'side', header: 'Side' },
        ]"
      >
        <template #score-cell="{ row }">
          {{ (Number(row.original.score) / 1e18).toFixed(4) }}
        </template>
        <template #expectedApr-cell="{ row }">
          {{ formatAPR(row.original.expectedApr) }}
        </template>
        <template #ilAtCurrentPrice-cell="{ row }">
          {{ formatIL(row.original.ilAtCurrentPrice) }}
        </template>
        <template #capitalEfficiency-cell="{ row }">
          {{ (Number(row.original.capitalEfficiency) / 1e18).toFixed(2) }}×
        </template>
      </UTable>
    </div>
  </div>
</template>
