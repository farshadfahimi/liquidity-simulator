// app/core/providers/history/create_history_provider.factory.ts

import type { IRpcProvider } from '@core/providers/rpc';

import { RpcHistoryProvider } from './rpc_history_provider.class';

/**
 * Compose an RPC-backed history provider. Future factories can swap in
 * archive-node or subgraph implementations without changing call sites.
 */
export function createHistoryProvider(
  rpc: IRpcProvider,
): RpcHistoryProvider {
  return new RpcHistoryProvider(rpc);
}
