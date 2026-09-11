<script setup lang="ts">

// app/components/PoolHeader.vue
//
// Top section of the pool detail page: back button + chain/fee
// badges + pool address. Extracted from `app/pages/pool/[pool].vue`
// in Phase 9 (§6.10 follow-up). Pure presentational.

interface IProps {
  poolAddress: string;
  chainId: number;
  feeTier: number;
  protocolId: string;
  title: string | null;
  loading: boolean;
}

defineProps<IProps>();

defineEmits<{
  (e: 'back'): void;
}>();
</script>

<template>
  <div class="flex items-center gap-3">
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-arrow-left"
      @click="$emit('back')"
    >
      Back
    </UButton>
    <UBadge color="primary" variant="subtle">
      chain {{ chainId }} · fee {{ feeTier / 10000 }}%
    </UBadge>
    <UBadge color="neutral" variant="subtle">
      adapter {{ protocolId }}
    </UBadge>
  </div>

  <UCard>
    <template #header>
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold">
            <span v-if="title">{{ title }}</span>
            <span v-else-if="loading">Loading pool…</span>
            <span v-else>Pool</span>
          </h1>
          <p
            v-if="poolAddress"
            class="font-mono text-xs text-muted break-all"
          >
            {{ poolAddress }}
          </p>
        </div>
      </div>
    </template>
    <slot />
  </UCard>
</template>
