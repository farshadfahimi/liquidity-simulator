<script setup lang="ts">

// app/components/TokenSelect.vue
//
// Presentational token picker. Wraps Nuxt UI's `USelectMenu`
// and shows each option as `icon + SYMBOL — name`. The v-model
// binds the *address* (string), not the full token row, so the
// parent's submit handler is unchanged from the previous
// raw-input version of the form.
//
// The option list is sourced from `useTokenList({ chainId, ... })`,
// which re-populates the moment the user switches chains. The
// `chainId` ref is the only required input; the parent doesn't
// have to know about the curated list shape.

import type { ITokenRow } from '~/data/tokens/curated';

interface ITokenOption {
  /** Token contract address — this is the v-model value. */
  value: string;
  /** Ticker shown in the closed select. */
  label: string;
  /** Long form shown as the description / search input hint. */
  name: string;
  /** Optional TrustWallet PNG URL; selector falls back to a dot icon if missing or 404. */
  icon?: string;
}

interface Props {
  /** v-model: the selected token's address (`0x...`). Empty string = nothing selected. */
  modelValue: string;
  /** Reactive chain id — used to look up the curated list if `tokens` isn't passed. */
  chainId: number;
  /**
   * Optional pre-resolved token list. The parent usually passes
   * `useTokenList({ chainId }).tokens` so a single composable
   * instance is shared between the two `TokenSelect` rows and
   * the chain-switch watcher. If omitted, the component calls
   * `useTokenList({ chainId })` itself — fine for isolated
   * usage but a duplicate subscription in the form.
   */
  tokens?: readonly ITokenRow[];
  /** Optional placeholder shown when nothing is selected. */
  placeholder?: string;
  /** Disabled state. */
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  tokens: undefined,
  placeholder: 'Select a token',
  disabled: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

// Pull the curated list for the active chain if the parent
// didn't pre-resolve one. `useTokenList` re-runs whenever
// `chainId` changes, so a chain switch repopulates the
// dropdown automatically.
//
// We pass an empty `protocolId` here: the standalone usage of
// `TokenSelect` (e.g. in a test or future page) doesn't know
// which adapter is active. The composable treats the empty
// string as "no dynamic source registered" and returns the
// curated list unchanged — exactly the right behaviour.
const fallbackList = useTokenList({
  chainId: computed(() => props.chainId),
  protocolId: computed(() => ''),
});

const sourceList = computed<readonly ITokenRow[]>(() => props.tokens ?? fallbackList.tokens.value);

/**
 * Map curated rows to the shape Nuxt UI's `USelectMenu` expects.
 * `value` is the address (so v-model binds the address), `label`
 * is the ticker shown in the closed select, and `name` is the
 * long form shown in the search hint / item description.
 */
const items = computed<ITokenOption[]>(() =>
  sourceList.value.map((t) => ({
    value: t.address,
    label: t.symbol,
    name: t.name,
    icon: t.logoURI,
  })),
);

/**
 * Two-way binding. USelectMenu emits the option object, but
 * the form only needs the address — so we pluck `.value` on
 * the way out and `.value` on the way in. Empty string is
 * used as the "nothing selected" sentinel.
 */
const selectedAddress = computed<string>({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v ?? ''),
});

// Track which icon URLs have failed so we can swap to a dot
// without re-triggering on every render. Map keyed by URL.
const brokenIcons = reactive<Record<string, boolean>>({});

function onIconError(url: string): void {
  brokenIcons[url] = true;
}

function shouldShowIcon(option: ITokenOption | undefined): boolean {
  if (!option?.icon) return false;
  return !brokenIcons[option.icon];
}

// Lookup of the currently-selected option (closed-state trigger).
const selectedOption = computed<ITokenOption | undefined>(() =>
  items.value.find((i) => i.value === props.modelValue),
);
</script>

<template>
  <USelectMenu
    v-model="selectedAddress"
    :items="items"
    value-key="value"
    :placeholder="placeholder"
    :disabled="disabled || items.length === 0"
    class="w-full"
  >
    <!--
      Per-item leading slot. Nuxt UI calls this for every row
      in the dropdown. We render the TrustWallet PNG, falling
      back to a generic dot if the URL 404s.
    -->
    <template #item-leading="{ item }">
      <template v-if="item">
        <img
          v-if="shouldShowIcon(item as ITokenOption)"
          :src="(item as ITokenOption).icon"
          :alt="(item as ITokenOption).label"
          width="20"
          height="20"
          class="rounded-full bg-muted"
          loading="lazy"
          @error="(item as ITokenOption).icon && onIconError((item as ITokenOption).icon as string)"
        >
        <UIcon
          v-else
          name="i-lucide-circle-dot"
          class="size-5 text-muted"
        />
      </template>
    </template>

    <!-- Closed-state leading slot (the trigger button). -->
    <template #leading>
      <template v-if="selectedOption">
        <img
          v-if="shouldShowIcon(selectedOption)"
          :src="selectedOption.icon"
          :alt="selectedOption.label"
          width="20"
          height="20"
          class="rounded-full bg-muted"
          loading="lazy"
          @error="selectedOption.icon && onIconError(selectedOption.icon)"
        >
        <UIcon
          v-else
          name="i-lucide-circle-dot"
          class="size-5 text-muted"
        />
      </template>
    </template>

    <!--
      Custom label rendering: `<SYMBOL> — <name>`. Nuxt UI's
      default `label` is the ticker; the description column is
      the long form.
    -->
    <template #item-label="{ item }">
      <template v-if="item">
        <span class="font-semibold">{{ (item as ITokenOption).label }}</span>
        <span class="text-muted text-sm ml-2">{{ (item as ITokenOption).name }}</span>
      </template>
    </template>
  </USelectMenu>
</template>
