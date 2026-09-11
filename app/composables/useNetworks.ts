// app/composables/useNetworks.ts

import type { TNetwork } from '@core/shared/types';
import {
  ethereum,
  arbitrumNetwork,
  baseNetwork,
  sonicNetwork,
} from '@core/network';

/**
 * Static list of bundled `TNetwork`s. The four networks here
 * mirror `app/core/network/networks/`. Pulled into a constant so
 * the UI doesn't have to reach across the Core boundary at
 * render time.
 *
 * `display` is an optional `label` used by the network selector
 * dropdown (the registry stores raw chain metadata). Tweak
 * freely — these labels are user-facing only.
 */
export interface INetworkOption extends TNetwork {
  readonly display: string;
}

export const BUNDLED_NETWORKS: readonly INetworkOption[] = Object.freeze([
  { ...ethereum, display: 'Ethereum' },
  { ...arbitrumNetwork, display: 'Arbitrum' },
  { ...baseNetwork, display: 'Base' },
  { ...sonicNetwork, display: 'Sonic' },
]);

/**
 * Find the option for a given chain id, or `undefined` if it's
 * not bundled.
 */
export function findNetworkOption(chainId: number): INetworkOption | undefined {
  return BUNDLED_NETWORKS.find((n) => n.id === chainId);
}

/**
 * Reactive accessor wrapping `useCoreServices().network`. Returns
 * `null` during SSR.
 */
export function useActiveNetwork(): {
  network: ComputedRef<TNetwork | null>;
  option: ComputedRef<INetworkOption | null>;
} {
  const { network } = useCoreServices();

  const active = computed(() => (network ? network.current() : null));
  const option = computed(() => {
    const n = active.value;
    return n ? findNetworkOption(n.id) ?? null : null;
  });

  return { network: active, option };
}
