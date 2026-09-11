// app/core/domains/history/create_pool_history.factory.ts

import type { TAddress } from '../../shared/types';
import type { TChainId } from '../../shared/types';
import type { PoolSnapshot } from './pool_snapshot.value-object';
import { PoolHistory } from './pool_history.class';

/**
 * Options accepted by {@link createPoolHistory}.
 */
export interface ICreatePoolHistoryOptions {
  pool: TAddress;
  chainId: TChainId;
  snapshots?: readonly PoolSnapshot[];
}

/**
 * Construct a {@link PoolHistory} aggregate from a (possibly empty) list
 * of snapshots. Empty histories are allowed.
 */
export function createPoolHistory(
  options: ICreatePoolHistoryOptions,
): PoolHistory {
  return new PoolHistory(
    options.pool,
    options.chainId,
    options.snapshots ?? [],
  );
}
