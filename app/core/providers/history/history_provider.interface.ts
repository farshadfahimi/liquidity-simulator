// app/core/providers/history/history_provider.interface.ts

import type { THex } from '@core/shared/types';
import type { TBlockRange } from '@core/shared/types';
import type { TBlock } from '@core/providers/rpc';
import type { TLog } from '@core/providers/rpc';
import type { TLogFilter } from '@core/providers/rpc';

/**
 * History provider: walks historical blocks via an underlying RPC. Future
 * implementations could read from a database, subgraph, or archive node.
 */
export interface IHistoryProvider {
  /**
   * Yield block snapshots stepping through [fromBlock, toBlock].
   * If `step` is undefined, every block in range is returned.
   */
  replayBlocks(
    range: TBlockRange,
  ): Promise<readonly TBlock[]>;

  /**
   * Yield logs matching `filter`, replayed block-by-block in `step`
   * windows to avoid node-side query-size limits.
   */
  replayLogs(
    filter: Omit<TLogFilter, 'fromBlock' | 'toBlock'>,
    range: TBlockRange,
  ): Promise<readonly TLog[]>;

  /**
   * Single block by number.
   */
  getBlock(blockNumber: bigint): Promise<TBlock>;

  /**
   * Current latest block number.
   */
  getLatestBlockNumber(): Promise<bigint>;
}

export type { THex };
