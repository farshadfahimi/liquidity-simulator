// app/core/providers/history/rpc_history_provider.class.ts

import type { IRpcProvider } from '@core/providers/rpc';
import type { TBlock } from '@core/providers/rpc';
import type { TLog } from '@core/providers/rpc';
import type { TLogFilter } from '@core/providers/rpc';
import type { TBlockRange } from '@core/shared/types';
import type { IHistoryProvider } from './history_provider.interface';

/**
 * History provider that walks the chain via an underlying RPC provider.
 * Logs are queried in `step`-sized windows to stay within RPC limits.
 */
export class RpcHistoryProvider implements IHistoryProvider {
  constructor(
    private readonly rpc: IRpcProvider,
  ) {}

  async replayBlocks(
    range: TBlockRange,
  ): Promise<readonly TBlock[]> {
    const blocks: TBlock[] = [];

    for (
      let n = range.fromBlock;
      n <= range.toBlock;
      n += range.step
    ) {
      const block = await this.rpc.getBlock(n);

      blocks.push(block);
    }

    return blocks;
  }

  async replayLogs(
    filter: Omit<TLogFilter, 'fromBlock' | 'toBlock'>,
    range: TBlockRange,
  ): Promise<readonly TLog[]> {
    const allLogs: TLog[] = [];

    for (
      let from = range.fromBlock;
      from <= range.toBlock;
      from += range.step
    ) {
      const to = from + range.step - 1n > range.toBlock
        ? range.toBlock
        : from + range.step - 1n;

      const windowLogs = await this.rpc.getLogs({
        ...filter,
        fromBlock: from,
        toBlock: to,
      });

      allLogs.push(...windowLogs);
    }

    return allLogs;
  }

  async getBlock(blockNumber: bigint): Promise<TBlock> {
    return this.rpc.getBlock(blockNumber);
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.rpc.getBlockNumber();
  }
}
