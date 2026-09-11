// app/core/adapters/shadow/pools/pool_discovery.class.ts

import type { IRpcProvider } from '@core/providers/rpc';

import { shadowV3FactoryAbi } from '../abi/shadow_v3_factory.abi';
import type { TAddress } from '@core/shared/types';
import type { TChainId } from '@core/shared/types';
import { NoAdapterForChainError } from '@core/shared/errors';

/**
 * On-demand pool lookup against the Shadow CL Factory.
 */
export class ShadowPoolDiscovery {
  constructor(
    private readonly rpc: IRpcProvider,
    private readonly factoryAddressFor: (
      chainId: TChainId,
    ) => TAddress | undefined,
  ) {}

  async lookupPool(
    tokenA: TAddress,
    tokenB: TAddress,
    fee: number,
  ): Promise<TAddress | null> {
    const factory = this.factoryAddressFor(this.rpc.chainId);
    if (!factory) {
      throw new NoAdapterForChainError(this.rpc.chainId);
    }

    const pool = (await this.rpc.readContract<TAddress>({
      address: factory,
      abi: shadowV3FactoryAbi,
      functionName: 'getPool',
      args: [tokenA, tokenB, fee],
    })) as TAddress;

    if (pool.toLowerCase() === '0x0000000000000000000000000000000000000000') {
      return null;
    }
    return pool;
  }
}
