// app/core/network/create_network_provider.factory.ts

import { NetworkProvider } from './network_provider.class';
import type { INetworkProvider } from './network_provider.interface';
import type { INetworkRegistry } from './network_registry.interface';
import type { TChainId } from '@core/shared/types';

export interface ICreateNetworkProviderOptions {
  registry: INetworkRegistry;

  chainId: TChainId;
}

/**
 * Compose a NetworkProvider pinned to an initial chain.
 */
export function createNetworkProvider(
  opts: ICreateNetworkProviderOptions,
): INetworkProvider {
  return new NetworkProvider(opts.registry, opts.chainId);
}
