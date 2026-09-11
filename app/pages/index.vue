<script setup lang="ts">

// app/pages/index.vue
//
// Discover Pool page. In Phase 9 the inline form was extracted
// into `app/components/DiscoverForm.vue`; this page now owns
// only the layout, the meta, and the navigation to the pool
// detail page on a successful lookup.
//
// All composables, constants, and helpers are Nuxt-auto-imported
// from `app/composables/` and `app/utils/`.

import type { TAddress } from '@core/shared/types';

useHead({
  title: 'Analyze Web3 — LP Analytics',
  meta: [
    {
      name: 'description',
      content:
        'Client-side liquidity position analytics for Uniswap V3-style AMMs. No wallet required.',
    },
  ],
});

definePageMeta({
  layout: 'default',
});

const router = useRouter();

const settingsOpen = ref(false);

async function onSubmitSuccess(payload: {
  chainId: number;
  protocolId: string;
  fee: number;
  tokenA: TAddress;
  tokenB: TAddress;
  result: { pool: TAddress; fee: number };
}) {
  await router.push({
    path: `/pool/${payload.result.pool}`,
    query: {
      chainId: String(payload.chainId),
      protocolId: payload.protocolId,
      fee: String(payload.fee),
      tokenA: payload.tokenA,
      tokenB: payload.tokenB,
    },
  });
}

function onSubmitError(_message: string) {
  // The form already surfaces the error inline; no toast here
  // because the form's USelectMenu owns its own state.
}
</script>

<template>
  <UContainer class="py-12">
    <div class="max-w-3xl mx-auto">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h1 class="text-2xl font-semibold">Discover a pool</h1>
            <div class="flex items-center gap-2">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-settings-2"
                @click="settingsOpen = true"
              >
                Custom RPC
              </UButton>
              <UBadge color="primary" variant="subtle">
                client-side · no wallet
              </UBadge>
            </div>
          </div>
        </template>

        <ClientOnly>
          <DiscoverForm
            @submit-success="onSubmitSuccess"
            @submit-error="onSubmitError"
          />

          <template #fallback>
            <div class="py-8 text-center text-muted">
              Initializing LP analytics…
            </div>
          </template>
        </ClientOnly>
      </UCard>

      <p class="text-sm text-muted text-center mt-6">
        All data is fetched live via public RPCs. Nothing is sent to a server.
      </p>
    </div>

    <!--
      Custom RPC slideover. The settings form is a separate
      component so it can be unit-tested and reused on a future
      settings page without duplicating markup. State is
      local to the component; persistence is via
      `useRpcOverride` which writes to localStorage.
    -->
    <USlideover v-model:open="settingsOpen" side="right">
      <template #content>
        <div class="p-6 space-y-4">
          <h2 class="text-lg font-semibold">Custom RPC URLs</h2>
          <RpcSettings />
        </div>
      </template>
    </USlideover>
  </UContainer>
</template>
