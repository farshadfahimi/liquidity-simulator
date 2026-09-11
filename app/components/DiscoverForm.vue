<script setup lang="ts">

// app/components/DiscoverForm.vue
//
// "Discover a pool" form. Extracted from `app/pages/index.vue`
// in Phase 9 as part of the §6.10 follow-up to split inline
// UI into `app/components/*.vue`. Pure presentational: it
// expects the parent (the page) to own the navigation, while
// this component owns the form state and validation.
//
// `BUNDLED_NETWORKS`, `ADAPTER_REGISTRY`, `adapterOptionsForChain`,
// `usePoolLookup`, `useSessionState`, `useTokenList`, and the
// `ref` / `computed` / `watch` / `onMounted` globals are
// auto-imported by Nuxt.
//
// Phase 9 slice 5 replaces the two raw `UInput` address fields
// with `TokenSelect` dropdowns, sourced from a curated
// per-chain token list (`useTokenList` → `app/data/tokens/curated.ts`).
// The submit payload still carries plain `0x...` addresses, so
// the lookup use case is unchanged.

import type { TAddress, TTokenRow } from '@core/shared/types';

import { tokensForChain as tokensForChainCurated } from '~/data/tokens/curated';

interface IPoolLookupResult {
  pool: TAddress;
  fee: number;
}

const emit = defineEmits<{
  (e: 'submit-success', payload: {
    chainId: number;
    protocolId: string;
    fee: number;
    tokenA: TAddress;
    tokenB: TAddress;
    result: IPoolLookupResult;
  }): void;
  (e: 'submit-error', message: string): void;
}>();

const session = useSessionState();

// -----------------------------------------------------------------
// State — seeded from session (if present) else from defaults.
// -----------------------------------------------------------------
// Default pre-fill addresses. USDC on Ethereum mainnet (the most-
// common pool) plus WETH; on chain switch we clear + re-pre-fill
// if the current selection isn't in the new chain's curated list.
const DEFAULT_TOKEN_A_BY_CHAIN: Readonly<Record<number, string>> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',     // USDC (Ethereum)
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // USDC (Arbitrum native)
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',   // USDC (Base)
  146: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894',   // USDC.e (Sonic bridged)
};
const DEFAULT_TOKEN_B_BY_CHAIN: Readonly<Record<number, string>> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',     // WETH (Ethereum)
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH (Arbitrum)
  8453: '0x4200000000000000000000000000000000000006',   // WETH (Base)
  146: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38',  // wS (Sonic)
};

const seedChainId = (() => {
  const stored = session.lastChainId.value;
  if (stored !== null && BUNDLED_NETWORKS.some((n) => n.id === stored)) {
    return stored;
  }
  return BUNDLED_NETWORKS[0]!.id;
})();

const seedProtocolId = (() => {
  const stored = session.lastProtocolId.value;
  const opts = ADAPTER_REGISTRY[seedChainId] ?? [];
  if (stored && opts.some((o) => o.protocolId === stored)) {
    return stored;
  }
  return opts[0]?.protocolId ?? '';
})();

const chainId = ref<number>(seedChainId);
const protocolId = ref<string>(seedProtocolId);
const feeTier = ref<number>(500); // 0.05% — mainnet USDC/WETH default
// Token A/B are bound by address (string). The TokenSelect component
// reads the curated list for `chainId` and renders icons + names.
const tokenAInput = ref<string>(DEFAULT_TOKEN_A_BY_CHAIN[seedChainId] ?? '');
const tokenBInput = ref<string>(DEFAULT_TOKEN_B_BY_CHAIN[seedChainId] ?? '');

// Token list, scoped to the active `(chainId, protocolId)`. Starts
// from the curated list (instant cold start) and upgrades to the
// per-adapter dynamic source (Uniswap default token list / Shadow
// API) in the background; result is cached in localStorage for 24h.
// `refresh()` bypasses the cache and is wired to the "Refresh"
// button in the form header.
const tokenList = useTokenList({
  chainId,
  protocolId,
});

// Re-expose as a top-level computed so the template auto-unwraps
// it (Vue's template compiler only auto-unwraps refs that are
// direct properties of the render context, not nested inside
// plain objects like `tokenList.tokens`).
const tokenOptions = computed<readonly ITokenRow[]>(() => tokenList.tokens.value);
const isRefreshingTokens = computed<boolean>(() => tokenList.isRefreshing.value);

const { lookupPool, lastError, isLooking } = usePoolLookup();

// -----------------------------------------------------------------
// Derived dropdown options.
// -----------------------------------------------------------------
const networkOptions = computed(() =>
  BUNDLED_NETWORKS.map((n) => ({ value: n.id, label: n.display })),
);

// Adapters are scoped to the currently-selected chain.
const adapterOptions = computed(() =>
  adapterOptionsForChain(chainId.value).map((a) => ({
    value: a.protocolId,
    label: a.display,
  })),
);

watch(chainId, (newChainId, oldChainId) => {
  // Persist + snap to first available adapter for the new chain,
  // and re-pre-fill tokenA/tokenB if the current selection isn't
  // on the new chain (USDC on Ethereum doesn't exist on Sonic).
  if (newChainId !== oldChainId) {
    session.setChainId(newChainId);

    // Adapter snap.
    const opts = ADAPTER_REGISTRY[newChainId] ?? [];
    const stillValid = opts.some((o) => o.protocolId === protocolId.value);
    const next = stillValid
      ? protocolId.value
      : (opts[0]?.protocolId ?? '');
    protocolId.value = next;
    if (next) session.setProtocolId(next);

    // Token re-pre-fill. If the current tokenA/tokenB isn't in
    // the new chain's curated list (same address doesn't appear),
    // fall back to that chain's default USDC/WETH pair. This
    // keeps the "one click to analyze" UX working after a chain
    // switch without silently keeping a stale address.
    //
    // IMPORTANT: read directly from the curated list, NOT from
    // `tokenOptions.value`. The composable's dynamic upgrade
    // populates `tokenOptions` with 405 mainnet tokens after a
    // brief delay; if the chain switch fires before that upgrade
    // and we read from `tokenOptions`, we'd see the OLD chain's
    // dynamic list (which still contains the old USDC address)
    // and incorrectly think the address is on the new chain.
    // The curated list is the source of truth for "is this
    // address known on this chain".
    const newChainList = tokensForChainCurated(newChainId);
    const aOnNewChain = newChainList.some(
      (t) => t.address.toLowerCase() === tokenAInput.value.toLowerCase(),
    );
    const bOnNewChain = newChainList.some(
      (t) => t.address.toLowerCase() === tokenBInput.value.toLowerCase(),
    );
    if (!aOnNewChain) {
      tokenAInput.value = DEFAULT_TOKEN_A_BY_CHAIN[newChainId] ?? '';
    }
    if (!bOnNewChain) {
      tokenBInput.value = DEFAULT_TOKEN_B_BY_CHAIN[newChainId] ?? '';
    }
  }
});

watch(protocolId, (id) => {
  if (id) session.setProtocolId(id);
});

// -----------------------------------------------------------------
// Validation + fee tier options.
// -----------------------------------------------------------------
const feeTierOptions = [
  { value: 100, label: '0.01% (best for stable pairs)' },
  { value: 500, label: '0.05% (standard)' },
  { value: 3000, label: '0.30% (standard)' },
  { value: 10_000, label: '1.00% (exotic)' },
];

// Defensive: the TokenSelect dropdown only emits values from the
// curated list, so `tokenAInput` / `tokenBInput` should always be
// valid 0x addresses. The regex check stays as a net for any edge
// case where the dropdown is bypassed (e.g. a future "custom
// address" affordance).
const isValidAddress = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s.trim());

const canSubmit = computed(() =>
  isValidAddress(tokenAInput.value)
  && isValidAddress(tokenBInput.value)
  && tokenAInput.value.toLowerCase() !== tokenBInput.value.toLowerCase()
  && chainId.value !== null
  && protocolId.value !== ''
  && !isLooking.value,
);

// -----------------------------------------------------------------
// Submit.
// -----------------------------------------------------------------
const errorMessage = ref<string | null>(null);

async function onSubmit() {
  errorMessage.value = null;

  const a = tokenAInput.value.trim() as TAddress;
  const b = tokenBInput.value.trim() as TAddress;

  const result = await lookupPool({
    chainId: chainId.value,
    protocolId: protocolId.value,
    tokenA: a,
    tokenB: b,
    fee: feeTier.value,
  });

  if (result === null) {
    const message = lastError.value ?? 'Unknown error during lookup.';
    errorMessage.value = message;
    emit('submit-error', message);
    return;
  }

  emit('submit-success', {
    chainId: chainId.value,
    protocolId: protocolId.value,
    fee: feeTier.value,
    tokenA: a,
    tokenB: b,
    result,
  });
}

// -----------------------------------------------------------------
// Refresh button — forces a refetch of the dynamic token list
// for the active (chainId, protocolId), bypassing the 24h
// localStorage cache. Surfaces a UToast on success / failure
// via the `useToast` composable (Nuxt UI auto-imports it).
// -----------------------------------------------------------------
const toast = useToast();

async function onRefreshTokens() {
  if (tokenList.isRefreshing.value) return;
  const ok = await tokenList.refresh();
  if (ok) {
    toast.add({
      title: `Token list refreshed — ${tokenOptions.value.length} tokens loaded`,
      color: 'success',
      icon: 'i-lucide-check-circle',
    });
  }
  else {
    toast.add({
      title: 'Token list refresh failed — using cached list',
      description: 'Network error, rate limit, or no source registered for this adapter.',
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
    });
  }
}
</script>

<template>
  <form class="space-y-6" @submit.prevent="onSubmit">
    <UFormField
      label="Network"
      description="The chain whose RPC the lookup will hit."
      name="chainId"
    >
      <USelectMenu
        v-model="chainId"
        :items="networkOptions"
        value-key="value"
        class="w-full"
      />
    </UFormField>

    <UFormField
      label="Adapter"
      description="Protocol adapter available for the selected network."
      name="protocolId"
    >
      <USelectMenu
        v-model="protocolId"
        :items="adapterOptions"
        value-key="value"
        :disabled="adapterOptions.length === 0"
        class="w-full"
      />
    </UFormField>

    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium">Token pair</span>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="isRefreshingTokens"
          :disabled="isRefreshingTokens"
          @click="onRefreshTokens"
        >
          {{ isRefreshingTokens ? 'Refreshing…' : 'Refresh tokens' }}
        </UButton>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UFormField
          label="Token A"
          description="First token of the pair (or the only token for single-asset pools)."
          name="tokenA"
        >
          <TokenSelect
            v-model="tokenAInput"
            :chain-id="chainId"
            :tokens="tokenOptions"
            placeholder="Pick a token"
          />
        </UFormField>

        <UFormField
          label="Token B"
          description="Second token of the pair."
          name="tokenB"
        >
          <TokenSelect
            v-model="tokenBInput"
            :chain-id="chainId"
            :tokens="tokenOptions"
            placeholder="Pick a token"
          />
        </UFormField>
      </div>
    </div>

    <UAlert
      v-if="tokenAInput && tokenBInput && tokenAInput.toLowerCase() === tokenBInput.toLowerCase()"
      color="warning"
      variant="subtle"
      title="Token A and Token B are the same — pick a different pair."
      icon="i-lucide-alert-triangle"
    />

    <UFormField
      label="Fee tier"
      description="Select the fee band of the pool you want to look up."
      name="feeTier"
    >
      <USelectMenu
        v-model="feeTier"
        :items="feeTierOptions"
        value-key="value"
        class="w-full"
      />
    </UFormField>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      :title="errorMessage"
      icon="i-lucide-alert-circle"
    />

    <div class="flex items-center justify-end gap-3">
      <UButton
        type="submit"
        color="primary"
        size="lg"
        :loading="isLooking"
        :disabled="!canSubmit"
      >
        Analyze pool
      </UButton>
    </div>
  </form>
</template>
