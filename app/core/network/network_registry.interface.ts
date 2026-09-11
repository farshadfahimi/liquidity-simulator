// app/core/network/network_registry.interface.ts

import type { TChainId } from '@core/shared/types';
import type { TNetwork } from '@core/shared/types';

/**
 * Registry of supported networks, keyed by chainId.
 */
export interface INetworkRegistry {
  register(network: TNetwork): void;

  unregister(chainId: TChainId): void;

  get(chainId: TChainId): TNetwork;

  has(chainId: TChainId): boolean;

  all(): readonly TNetwork[];
}
