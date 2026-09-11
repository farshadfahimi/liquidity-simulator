// app/core/network/network_registry.class.ts

import { UnknownNetworkError } from '@core/shared/errors';
import type { TChainId } from '@core/shared/types';
import type { TNetwork } from '@core/shared/types';
import type { INetworkRegistry } from './network_registry.interface';

export class NetworkRegistry implements INetworkRegistry {
  private readonly byId: Map<TChainId, TNetwork> = new Map();

  register(network: TNetwork): void {
    this.byId.set(network.id, network);
  }

  unregister(chainId: TChainId): void {
    this.byId.delete(chainId);
  }

  get(chainId: TChainId): TNetwork {
    const n = this.byId.get(chainId);

    if (!n) {
      throw new UnknownNetworkError(chainId);
    }

    return n;
  }

  has(chainId: TChainId): boolean {
    return this.byId.has(chainId);
  }

  all(): readonly TNetwork[] {
    return [...this.byId.values()];
  }
}
