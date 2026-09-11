<script setup lang="ts">

// app/components/RpcSettings.vue
//
// Per-chain RPC URL settings panel. Phase 9 slice 4.
//
// Lets the user pin a personal endpoint (Alchemy / Infura /
// Tenderly fork / private node) for any of the four bundled
// chains. The override is persisted to `localStorage` via
// `useRpcOverride()` and folded into `TNetwork.rpcUrls` at
// the composition root (`app/plugins/core.client.ts`).
//
// Important: changes here do NOT take effect on the running
// app — the plugin has already wired the registry with the
// overrides that were persisted at boot. A page reload is
// required. The toast and inline hint make this clear.
//
// Validation is intentionally lightweight: a non-empty string
// that parses as `http://` or `https://`. We do NOT try to
// reach the endpoint (that would be a slow, side-effecty
// action from inside a form input).

import type { TChainId } from '@core/shared/types';

const override = useRpcOverride();
const toast = useToast();

interface IChainRow {
  chainId: TChainId;
  name: string;
  defaultUrl: string;
  draft: string;
  saved: string;
  error: string;
}

const rows = computed<IChainRow[]>(() => {
  // Build one row per bundled chain, seeded from the current
  // override (if any) so the form reflects persisted state.
  return BUNDLED_NETWORKS.map((n) => {
    const saved = override.getOverride(n.id);
    return {
      chainId: n.id as TChainId,
      name: n.display,
      defaultUrl: n.rpcUrls[0] ?? '',
      draft: saved,
      saved,
      error: '',
    };
  });
});

function isValidUrl(s: string): boolean {
  if (s.length === 0) return true; // empty == "use default"
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  }
  catch {
    return false;
  }
}

function saveRow(row: IChainRow) {
  if (!isValidUrl(row.draft)) {
    row.error = 'Must be an empty value or a full http(s) URL.';
    return;
  }
  row.error = '';
  override.setOverride(row.chainId, row.draft);
  row.saved = override.getOverride(row.chainId);
  toast.add({
    title: 'Custom RPC saved',
    description: `${row.name} → ${row.saved || 'public fallbacks'}. Reload to apply.`,
    color: 'success',
    icon: 'i-lucide-check-circle',
  });
}

function clearRow(row: IChainRow) {
  override.clearOverride(row.chainId);
  row.draft = '';
  row.saved = '';
  row.error = '';
  toast.add({
    title: 'Custom RPC cleared',
    description: `${row.name} → public fallbacks. Reload to apply.`,
    color: 'info',
    icon: 'i-lucide-info',
  });
}
</script>

<template>
  <div class="space-y-4">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-info"
      title="Custom RPC URLs"
      description="Pin a personal endpoint (Alchemy, Infura, Tenderly fork, private node) per chain. The endpoint is folded into the chain's RPC fallback list at the highest priority. A page reload is required for changes to take effect."
    />

    <div
      v-for="row in rows"
      :key="row.chainId"
      class="space-y-2 pb-4 border-b border-default last:border-0"
    >
      <div class="flex items-baseline justify-between gap-3">
        <label
          :for="`rpc-url-${row.chainId}`"
          class="text-sm font-medium"
        >
          {{ row.name }}
        </label>
        <span class="text-xs text-muted">
          default: <code>{{ row.defaultUrl }}</code>
        </span>
      </div>

      <UInput
        :id="`rpc-url-${row.chainId}`"
        v-model="row.draft"
        :placeholder="row.defaultUrl"
        :color="row.error ? 'error' : 'primary'"
        size="sm"
        autocomplete="off"
        spellcheck="false"
      />

      <p v-if="row.error" class="text-xs text-error">
        {{ row.error }}
      </p>
      <p
        v-else-if="row.saved"
        class="text-xs text-success"
      >
        <UIcon name="i-lucide-check" class="align-text-bottom" />
        Pinned: <code>{{ row.saved }}</code>
      </p>

      <div class="flex gap-2">
        <UButton
          size="xs"
          color="primary"
          icon="i-lucide-save"
          @click="saveRow(row)"
        >
          Save
        </UButton>
        <UButton
          v-if="row.saved"
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-lucide-x"
          @click="clearRow(row)"
        >
          Clear
        </UButton>
      </div>
    </div>
  </div>
</template>
