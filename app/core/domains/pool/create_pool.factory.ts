// app/core/domains/pool/create_pool.factory.ts

import type { TChainId } from '../../shared/types';
import type { TPoolState } from '../../adapters/types';
import type { TTick } from '../../adapters/types';
import { Pool } from './pool.class';

/**
 * Options accepted by {@link createPool}.
 */
export interface ICreatePoolOptions {
  state: TPoolState;

  chainId: TChainId;

  ticks?: readonly TTick[];
}

/**
 * Construct a new {@link Pool} aggregate from a live state plus an
 * optional initial tick set. The factory accepts a chainId so the
 * resulting pool knows which network it belongs to.
 */
export function createPool(
  options: ICreatePoolOptions,
): Pool {
  return new Pool(
    options.state,
    options.chainId,
    options.ticks ?? [],
  );
}
