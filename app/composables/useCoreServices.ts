// app/composables/useCoreServices.ts

import type { CoreServices, ICoreUseCases } from '@core/services';
import type { TAdapterRegistry } from '@core/services';

/**
 * Thin accessor for the client-side `CoreServices` composition
 * root installed by `app/plugins/core.client.ts`.
 *
 * Returns `null` during SSR (the plugin is client-only), so
 * consumers must `v-if` or `<ClientOnly>` anything that depends
 * on it. The Phase 8 pages already follow that pattern.
 *
 * The returned object also exposes convenience helpers:
 *
 *   - `useCases()` — fresh use-case bundle.
 *   - `switchChain(chainId)` — wired to `$switchChain`.
 *   - `rpc()` — current IRpcProvider for ad-hoc reads.
 */
export function useCoreServices(): {
  ready: ComputedRef<boolean>;
  services: CoreServices | null;
  adapters: TAdapterRegistry | null;
  rpc: CoreServices['rpc'] | null;
  network: CoreServices['network'] | null;
  analytics: CoreServices['analytics'] | null;
  useCases: (() => ICoreUseCases) | null;
  switchChain: ((chainId: number) => void) | null;
} {
  const nuxtApp = useNuxtApp();

  const ready = computed(() => Boolean(nuxtApp.$coreReady && nuxtApp.$core));

  return {
    ready,
    services: ready.value ? nuxtApp.$core : null,
    adapters: ready.value ? nuxtApp.$core.adapters : null,
    rpc: ready.value ? () => nuxtApp.$core.rpc() : null,
    network: ready.value ? nuxtApp.$core.network : null,
    analytics: ready.value ? nuxtApp.$core.analytics : null,
    useCases: ready.value ? () => nuxtApp.$core.useCases() : null,
    switchChain: ready.value ? (chainId: number) => nuxtApp.$switchChain(chainId) : null,
  };
}
