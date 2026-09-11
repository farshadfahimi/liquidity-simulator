// app/core/providers/rpc/create_rpc_provider.factory.ts

import type { Chain } from 'viem';

import { RpcProvider } from './rpc_provider.class';

export interface ICreateRpcProviderOptions {
  chain: Chain;

  /**
   * Ordered list of public RPC endpoints for the chain. The first
   * URL is the primary; the rest are fallbacks. Phase 9 introduced
   * this list after a single-endpoint failure (eth.llamarpc.com
   * NetworkError on eth_call from the browser) made the Discover
   * form unusable. viem's `fallback` transport cycles through the
   * list on transport-level failures (CORS, 5xx, timeouts).
   *
   * See AGENT.md §6.17.
   */
  rpcUrls: readonly string[];

  /**
   * @deprecated Use `rpcUrls`. Kept for the few callers that only
   * know about a single URL. If both are passed, `rpcUrls` wins.
   */
  rpcUrl?: string;
}

/**
 * Compose a viem-backed RPC provider for a given chain + RPC URL(s).
 * Internally uses viem's `fallback` transport so transport-level
 * failures on one endpoint transparently try the next.
 */
export function createRpcProvider(
  opts: ICreateRpcProviderOptions,
): RpcProvider {
  // Honor rpcUrls when present and non-empty; otherwise fall back
  // to the deprecated single-url field. The two are never both
  // required at the type level because every network const now
  // ships with both fields populated.
  const urls = opts.rpcUrls.length > 0
    ? opts.rpcUrls
    : (opts.rpcUrl ? [opts.rpcUrl] : []);

  if (urls.length === 0) {
    throw new Error(
      `createRpcProvider: no RPC URLs provided for chain ${opts.chain.id}`,
    );
  }

  return new RpcProvider({ chain: opts.chain, rpcUrls: urls });
}
