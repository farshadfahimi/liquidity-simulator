// app/core/network/network_provider.class.ts

import { defineChain } from 'viem';
import type { Chain } from 'viem';

import { createRpcProvider } from '@core/providers/rpc';
import type { IRpcProvider } from '@core/providers/rpc';
import type { TChainId } from '@core/shared/types';
import type { TNetwork } from '@core/shared/types';
import type { INetworkRegistry } from './network_registry.interface';
import type { INetworkProvider } from './network_provider.interface';

export class NetworkProvider implements INetworkProvider {
  private active: TNetwork;

  private readonly registry: INetworkRegistry;

  private rpcCache: Map<TChainId, IRpcProvider> = new Map();

  constructor(
    registry: INetworkRegistry,
    initialChainId: TChainId,
  ) {
    this.registry = registry;

    this.active = registry.get(initialChainId);
  }

  current(): TNetwork {
    return this.active;
  }

  rpc(): IRpcProvider {
    const chainId = this.active.id;

    let rpc = this.rpcCache.get(chainId);

    if (!rpc) {
      rpc = createRpcProvider({
        chain: this.toChain(this.active),
        rpcUrls: this.active.rpcUrls,
        // Phase 11 — fold the chain's auth headers (set by the
        // access-key composable at boot) onto the underlying
        // transport. Optional; public RPCs leave it undefined.
        ...(this.active.rpcHeaders
          ? { rpcHeaders: this.active.rpcHeaders }
          : {}),
      });

      this.rpcCache.set(chainId, rpc);
    }

    return rpc;
  }

  switch(chainId: TChainId): TNetwork {
    this.active = this.registry.get(chainId);

    return this.active;
  }

  private toChain(network: TNetwork): Chain {
    return defineChain({
      id: network.id,
      name: network.name,
      nativeCurrency: network.nativeCurrency,
      rpcUrls: {
        default: { http: [network.rpcUrl] },
      },
      blockExplorers: network.explorerUrl
        ? {
            default: {
              name: `${network.name} Explorer`,
              url: network.explorerUrl,
            },
          }
        : undefined,
      contracts: network.multicall3Address
        ? { multicall3: { address: network.multicall3Address } }
        : undefined,
    });
  }
}
