// app/core/adapters/uniswap/v3/pools/pool_discovery.class.ts

import type { IRpcProvider } from '@core/providers/rpc';

import { uniswapV3FactoryAbi } from '../abi/uniswap_v3_factory.abi';
import type { TAddress } from '@core/shared/types';
import type { TChainId } from '@core/shared/types';
import { NoAdapterForChainError } from '@core/shared/errors';
import { UniswapV3TokenResolver } from '../tokens/token_resolver.class';

/**
 * On-demand pool lookup against a Uniswap V3 factory contract.
 * Currently looks up pools by (token0, token1, fee) tuple.
 *
 * A more elaborate enumerator would iterate `PoolCreated` events; that
 * is left to future phases.
 */
export class UniswapV3PoolDiscovery {
  constructor(
    private readonly rpc: IRpcProvider,
    private readonly tokens: UniswapV3TokenResolver,
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
      abi: uniswapV3FactoryAbi,
      functionName: 'getPool',
      args: [tokenA, tokenB, fee],
    })) as TAddress;

    if (pool.toLowerCase() === '0x0000000000000000000000000000000000000000') {
      return null;
    }
    return pool;
  }
}
