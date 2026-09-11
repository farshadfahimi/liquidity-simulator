<script setup lang="ts">

// app/components/SimulationTab.vue
//
// "Simulation" tab content. Extracted from
// `app/pages/pool/[pool].vue` in Phase 9. Pure presentational.

interface IProps {
  tickLower: number;
  tickUpper: number;
  principal: string;
  numeraire: 'token0' | 'token1';
  loading: boolean;
  error: string | null;
  hasResult: boolean;
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
</script>

<template>
  <div class="space-y-4 mt-4">
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

    <div v-if="props.hasResult" class="space-y-2">
      <p class="text-muted text-sm">
        Use the canonical use cases (`simulatePosition.execute(...)`)
        to render this section in detail.
      </p>
    </div>
  </div>
</template>
