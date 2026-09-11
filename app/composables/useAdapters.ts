// app/composables/useAdapters.ts

import type { IProtocolAdapter } from '@core/adapters/protocol_adapter.interface';
import {
  ethereum,
  arbitrumNetwork,
  baseNetwork,
  sonicNetwork,
} from '@core/network';

/**
 * Static list of adapters selectable in the UI for a given chain.
 * Sourced from each adapter's own factory-address constants
 * (e.g. `app/core/adapters/uniswap/v3/addresses/...`):
 *
 *   - Uniswap V3  (`uniswap-v3`) — Ethereum (1), Arbitrum (42161), Base (8453)
 *   - Shadow CL   (`shadow-cl`)  — Sonic (146)
 *
 * The plugin's runtime registry mirrors this map (see
 * `app/plugins/core.client.ts`). The UI uses this list to drive
 * the adapter-selector dropdown, so users only ever see adapters
 * that are actually wired up for the network they picked.
 *
 * `display` is a UI-only label; `protocolId` is what gets passed
 * to use cases and adapter resolvers.
 */
export interface IAdapterOption {
  readonly protocolId: string;
  readonly display: string;
}

export const ADAPTER_REGISTRY: Readonly<Record<number, readonly IAdapterOption[]>> = Object.freeze({
  [ethereum.id]: [{ protocolId: 'uniswap-v3', display: 'Uniswap V3' }],
  [arbitrumNetwork.id]: [{ protocolId: 'uniswap-v3', display: 'Uniswap V3' }],
  [baseNetwork.id]: [{ protocolId: 'uniswap-v3', display: 'Uniswap V3' }],
  [sonicNetwork.id]: [{ protocolId: 'shadow-cl', display: 'Shadow CL' }],
});

/**
 * Pure helper: return the selectable adapter options for a chain.
 * Returns an empty array if the chain has no registered adapter
 * (the caller decides how to surface that — usually by greying
 * out the submit button).
 */
export function adapterOptionsForChain(chainId: number): readonly IAdapterOption[] {
  return ADAPTER_REGISTRY[chainId] ?? [];
}

/**
 * Reactive accessor for resolving a protocol adapter by chain id.
 * Backed by the singleton `CoreServices` instance installed by
 * `app/plugins/core.client.ts`.
 *
 * Returns `null` until the plugin has booted (i.e. during SSR, the
 * plugin still runs server-side so this is rarely needed; but the
 * shape stays consistent).
 */
export function useAdapters() {
  const { services } = useCoreServices();

  function adapterForChain(
    chainId: number,
    protocolId?: string,
  ): IProtocolAdapter | null {
    if (!services) return null;
    try {
      return services.resolveAdapter(chainId, protocolId);
    }
    catch {
      return null;
    }
  }

  return { adapterForChain };
}
