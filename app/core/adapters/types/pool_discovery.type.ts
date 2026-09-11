// app/core/adapters/types/pool_discovery.type.ts

import type { TAddress } from '@core/shared/types';
import type { TToken } from '@core/shared/types';

/**
 * Metadata describing a discoverable pool. Adapters populate this when
 * enumerating pools for a chain.
 */
export interface TPoolDiscovery {
  address: TAddress;

  token0: TToken;

  token1: TToken;

  fee: number;

  tickSpacing: number;
}
