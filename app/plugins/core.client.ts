// app/plugins/core.client.ts

/**
 * Client-only Nuxt plugin that wires up the Application-layer
 * composition root (see Phase 7 docs in AGENT.md §6.14).
 *
 * What this plugin does
 * ---------------------
 *
 * On first browser execution, it builds:
 *
 *   1. A `NetworkRegistry` populated with the four bundled networks
 *      (Ethereum mainnet, Arbitrum, Base, Sonic).
 *
 *   2. A `NetworkProvider` pinned to Ethereum mainnet.
 *
 *   3. A `CoreServices` bundle with every supported chain × adapter
 *      pair pre-wired into the registry:
 *        - Ethereum (1) / Arbitrum (42161) / Base (8453) → Uniswap V3
 *        - Sonic (146) → Shadow CL
 *      The full map is rebuilt on every chain switch because
 *      adapters bind to the network's current `IRpcProvider` at
 *      construction time.
 *
 * The whole tree is exposed as `nuxtApp.$core`, and any Nuxt-aware
 * code (composables, page components) can grab it through the
 * thin wrapper at `app/composables/useCoreServices.ts`.
 *
 * Why `.client.ts`
 * ----------------
 *
 * The plugin depends on viem + adapters, which inflate the
 * server bundle with code we never need at runtime on the
 * Node.js side. Keeping it client-only means the SSR pass
 * emits an empty `<div>` shell and the actual analytics run
 * exclusively in the browser.
 */

import {
  NetworkRegistry,
  createNetworkProvider,
  ethereum,
  arbitrumNetwork,
  baseNetwork,
  sonicNetwork,
} from '@core/network';
import {
  createCoreServices,
  type CoreServices,
  type TAdapterRegistry,
} from '@core/services';
import { createUniswapV3Adapter } from '@core/adapters/uniswap/v3';
import { createShadowAdapter } from '@core/adapters/shadow';
import type { IProtocolAdapter } from '@core/adapters/protocol_adapter.interface';
import type { TNetwork } from '@core/shared/types';

export default defineNuxtPlugin(() => {
  // -----------------------------------------------------------------
  // [0] User-pinned RPC overrides (Phase 9 slice 4 + Phase 11
  //     access-key slice).
  //
  // End users can pin a personal endpoint (Alchemy / Infura /
  // Tenderly fork / private node) via the settings drawer on
  // the Discover page. Those overrides live in localStorage and
  // are read here at plugin boot so the rest of the app — which
  // only knows about `TNetwork.rpcUrls` and `TNetwork.rpcHeaders`
  // — picks them up transparently.
  //
  // The user-pinned entry, when present, is composed of:
  //
  //   - `url`       — a fully-built URL (preset-expanded if the
  //                   user picked a paid provider, raw if they
  //                   picked "Custom"). Prepended to the chain's
  //                   public fallback list so it wins.
  //   - `headers`   — auth headers (Alchemy/Infura header mode,
  //                   Tenderly, private-node bearer tokens).
  //                   Forwarded to viem's `http()` transport as
  //                   `fetchOptions.headers` so they ride every
  //                   request made through the chain's RPC.
  //
  // viem's `fallback` transport still cycles through the public
  // URLs on transport-level failure (see AGENT.md §6.17). The
  // auth headers are sent on every request in the fallback list;
  // that's intentional — public fallbacks will simply ignore
  // incoming `x-api-key` headers.
  //
  // The override map is per-chain and may be empty, in which
  // case the bundled `TNetwork.rpcUrls` list is used as-is and
  // no extra headers are sent.
  // -----------------------------------------------------------------
  const rpcOverrides = useRpcOverride();

  const bundledById: Record<number, TNetwork> = {
    [ethereum.id]: ethereum,
    [arbitrumNetwork.id]: arbitrumNetwork,
    [baseNetwork.id]: baseNetwork,
    [sonicNetwork.id]: sonicNetwork,
  };

  function withOverride(network: TNetwork): TNetwork {
    const cfg = rpcOverrides.getConfig(network.id);
    const headers = cfg.headers;
    const url = cfg.url;

    if (!url && (!headers || Object.keys(headers).length === 0)) {
      return network;
    }

    const next: TNetwork = { ...network };

    if (url && url.length > 0) {
      next.rpcUrls = [url, ...network.rpcUrls];
      next.rpcUrl = url;
    }

    if (headers && Object.keys(headers).length > 0) {
      next.rpcHeaders = headers;
    }

    return next;
  }

  // -----------------------------------------------------------------
  // [1] Network registry — bundled networks known to the app,
  // each with its user override (if any) folded into `rpcUrls`.
  // -----------------------------------------------------------------
  const registry = new NetworkRegistry();
  for (const network of Object.values(bundledById)) {
    registry.register(withOverride(network));
  }

  // -----------------------------------------------------------------
  // [2] Network provider — starts on Ethereum mainnet.
  // -----------------------------------------------------------------
  const network = createNetworkProvider({ registry, chainId: ethereum.id });

  // -----------------------------------------------------------------
  // [3] Adapter registry — every chain × adapter pair the app
  // knows about. Each entry is a *factory* that builds an adapter
  // against the network provider's current RPC. Used both for the
  // initial wiring (so all supported adapters are registered up
  // front) and for re-registration on chain switch (because
  // adapters bind to a specific `IRpcProvider` at construction
  // time).
  //
  // Sourced from each adapter's own factory-address constants
  // (e.g. `app/core/adapters/uniswap/v3/addresses/...`):
  //   - Uniswap V3: Ethereum (1), Arbitrum (42161), Base (8453)
  //   - Shadow CL:  Sonic (146)
  // -----------------------------------------------------------------
  const adapterFactoriesByChain: Record<number, (() => IProtocolAdapter)[]> = {
    [ethereum.id]: [() => createUniswapV3Adapter({ rpc: network.rpc() })],
    [arbitrumNetwork.id]: [() => createUniswapV3Adapter({ rpc: network.rpc() })],
    [baseNetwork.id]: [() => createUniswapV3Adapter({ rpc: network.rpc() })],
    [sonicNetwork.id]: [() => createShadowAdapter({ rpc: network.rpc() })],
  };

  /**
   * Build a fresh `TAdapterRegistry` keyed by chain id, populated
   * with every supported adapter for each chain. Called once at
   * plugin boot and once per chain switch.
   */
  function buildAdapters(): TAdapterRegistry {
    const out: TAdapterRegistry = new Map();
    for (const [chainId, factories] of Object.entries(adapterFactoriesByChain)) {
      const id = Number(chainId);
      out.set(id, factories.map((f) => f()));
    }
    return out;
  }

  const services = createCoreServices({
    network,
    adapters: buildAdapters(),
  });

  /**
   * Switch the active chain and rebuild adapters for it. Adapters
   * bind to the network's current `IRpcProvider` at construction
   * time, so a switch must rebuild them against the new RPC.
   * Returns the new active `TNetwork`.
   */
  function switchChain(chainId: number) {
    network.switch(chainId);
    // Clear every chain so a freshly-built adapter for the new
    // chain sees the new RPC URL. (Cheap; we only have a handful
    // of registrations.)
    for (const id of Object.keys(adapterFactoriesByChain)) {
      services.clearAdapters(Number(id));
    }
    const factories = adapterFactoriesByChain[chainId] ?? [];
    for (const factory of factories) {
      services.registerAdapter(chainId, factory());
    }
    return network.current();
  }

  return {
    provide: {
      core: services,
      coreReady: true,
      switchChain,
    },
  };
});

// Make the plugin's custom $provide keys type-safe.
declare module '#app' {
  interface NuxtApp {
    $core: CoreServices;
    $coreReady: boolean;
    $switchChain: (chainId: number) => ReturnType<CoreServices['network']['current']>;
  }
}
