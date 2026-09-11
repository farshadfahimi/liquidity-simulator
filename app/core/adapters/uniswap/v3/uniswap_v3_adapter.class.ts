// app/core/adapters/uniswap/v3/uniswap_v3_adapter.class.ts

import type { IRpcProvider } from '@core/providers/rpc';

import { uniswapV3FactoryAddresses } from './addresses/uniswap_v3_factory_addresses.const';
import { UniswapV3PoolDiscovery } from './pools/pool_discovery.class';
import { UniswapV3PoolPositionQuoter } from './pools/pool_position_quoter.class';
import { UniswapV3PoolStateReader } from './pools/pool_state_reader.class';
import { UniswapV3TokenResolver } from './tokens/token_resolver.class';
import type { IProtocolAdapter } from '@core/adapters/protocol_adapter.interface';
import type { TAddress } from '@core/shared/types';
import type { TPoolDiscovery } from '@core/adapters/types';
import type { TPoolState } from '@core/adapters/types';
import type { TQuotePosition } from '@core/adapters/types';
import type { TTick } from '@core/adapters/types';
import type { TTickRange } from '@core/adapters/types';

const UNISWAP_V3_ID = 'uniswap-v3';
const UNISWAP_V3_NAME = 'Uniswap V3';
const UNISWAP_V3_VERSION = '3';

/**
 * Protocol adapter for Uniswap V3. Translates V3's on-chain shapes into
 * the protocol-neutral `T*` types via internal reader/quoter/discovery
 * helpers. Holds no viem types itself; the only RPC dependency is the
 * abstract `IRpcProvider`.
 */
export class UniswapV3Adapter implements IProtocolAdapter {
  readonly id = UNISWAP_V3_ID;
  readonly name = UNISWAP_V3_NAME;
  readonly version = UNISWAP_V3_VERSION;

  private readonly tokens: UniswapV3TokenResolver;
  private readonly reader: UniswapV3PoolStateReader;
  private readonly quoter: UniswapV3PoolPositionQuoter;
  private readonly discovery: UniswapV3PoolDiscovery;

  constructor(private readonly rpc: IRpcProvider) {
    this.tokens = new UniswapV3TokenResolver(rpc);
    this.reader = new UniswapV3PoolStateReader(rpc, this.tokens);
    this.quoter = new UniswapV3PoolPositionQuoter(rpc.chainId);
    this.discovery = new UniswapV3PoolDiscovery(
      rpc,
      this.tokens,
      (chainId) => uniswapV3FactoryAddresses[chainId],
    );
  }

  async discoverPools(): Promise<readonly TPoolDiscovery[]> {
    // Curated-on-discovery mode: this adapter doesn't ship with a static
    // pool list. Concrete use cases should drive discovery via
    // `lookupPool(tokenA, tokenB, fee)` and pass the resulting address
    // into `getPoolState`. Returning an empty array here keeps the
    // `IProtocolAdapter` contract satisfied.
    return [];
  }

  async getPoolState(pool: TAddress): Promise<TPoolState> {
    return this.reader.readFullState(pool);
  }

  async getTicks(
    pool: TAddress,
    range: TTickRange,
  ): Promise<readonly TTick[]> {
    const state = await this.reader.readFullState(pool);
    return this.reader.readTicks(pool, range, state.tickSpacing);
  }

  async quotePosition(
    pool: TAddress,
    range: TTickRange,
    token0Amount: bigint,
  ): Promise<TQuotePosition> {
    const state = await this.reader.readFullState(pool);
    return this.quoter.quote(state, range, token0Amount);
  }

  /**
   * Convenience helper for callers that already know the token pair and
   * fee tier. Returns `null` when no V3 pool exists for the triple.
   */
  async resolvePool(
    tokenA: TAddress,
    tokenB: TAddress,
    fee: number,
  ): Promise<TAddress | null> {
    return this.discovery.lookupPool(tokenA, tokenB, fee);
  }
}
