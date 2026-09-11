// app/core/domains/market/create_market.factory.ts

import type { TChainId } from '../../shared/types';
import type { Pool } from '../pool';
import { Market } from './market.class';

/**
 * Options accepted by {@link createMarket}.
 */
export interface ICreateMarketOptions {
  pool: Pool;
  chainId: TChainId;
  displayDecimals?: number;
}

/**
 * Construct a {@link Market} aggregate wrapping the supplied
 * {@link Pool}. `chainId` must be supplied explicitly since a `Pool`
 * constructed without an RPC provider may not have it; in practice the
 * factory accepts whichever the caller has on hand.
 */
export function createMarket(options: ICreateMarketOptions): Market {
  return new Market(options.pool, options.chainId, options.displayDecimals);
}
