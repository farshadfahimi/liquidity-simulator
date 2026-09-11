// app/core/adapters/shadow/shadow_adapter.class.ts

import type { IRpcProvider } from '@core/providers/rpc';

import { shadowV3FactoryAddresses } from './addresses/shadow_v3_factory_addresses.const';
import { ShadowPoolDiscovery } from './pools/pool_discovery.class';
import { ShadowPoolPositionQuoter } from './pools/pool_position_quoter.class';
import { ShadowPoolStateReader } from './pools/pool_state_reader.class';
import { ShadowTokenResolver } from './tokens/token_resolver.class';
import type { IProtocolAdapter } from '@core/adapters/protocol_adapter.interface';
import type { TAddress } from '@core/shared/types';
import type { TPoolDiscovery } from '@core/adapters/types';
import type { TPoolState } from '@core/adapters/types';
import type { TQuotePosition } from '@core/adapters/types';
import type { TTick } from '@core/adapters/types';
import type { TTickRange } from '@core/adapters/types';

const SHADOW_ID = 'shadow-cl';
const SHADOW_NAME = 'Shadow CL';
const SHADOW_VERSION = '3';

/**
 * Protocol adapter for Shadow CL on Sonic. Shadow is V3-compatible at
 * the math/storage level, but lives on its own factory deployment, so we
 * keep a parallel adapter rather than reusing the Uniswap V3 one.
 */
export class ShadowAdapter implements IProtocolAdapter {
  readonly id = SHADOW_ID;
  readonly name = SHADOW_NAME;
  readonly version = SHADOW_VERSION;

  private readonly tokens: ShadowTokenResolver;
  private readonly reader: ShadowPoolStateReader;
  private readonly quoter: ShadowPoolPositionQuoter;
  private readonly discovery: ShadowPoolDiscovery;

  constructor(private readonly rpc: IRpcProvider) {
    this.tokens = new ShadowTokenResolver(rpc);
    this.reader = new ShadowPoolStateReader(rpc, this.tokens);
    this.quoter = new ShadowPoolPositionQuoter(rpc.chainId);
    this.discovery = new ShadowPoolDiscovery(
      rpc,
      (chainId) => shadowV3FactoryAddresses[chainId],
    );
  }

  async discoverPools(): Promise<readonly TPoolDiscovery[]> {
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

  async resolvePool(
    tokenA: TAddress,
    tokenB: TAddress,
    fee: number,
  ): Promise<TAddress | null> {
    return this.discovery.lookupPool(tokenA, tokenB, fee);
  }
}
