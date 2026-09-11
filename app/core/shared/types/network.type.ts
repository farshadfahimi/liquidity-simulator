// app/core/shared/types/network.type.ts

import type { TAddress } from './address.type';
import type { TChainId } from './chain_id.type';

export interface TNativeCurrency {
  name: string;

  symbol: string;

  decimals: number;
}

export interface TNetwork {
  id: TChainId;

  name: string;

  /**
   * Ordered list of public RPC endpoints for this chain. The first
   * URL is the primary; the rest are fallbacks that viem's
   * `fallback` transport will rotate through on transport-level
   * failures (CORS, 5xx, timeouts). Phase 9 introduced this list
   * after a public endpoint (eth.llamarpc.com) failed reliably
   * from the browser while working from Node. See AGENT.md §6.17
   * for the rationale and the curated list per chain.
   */
  rpcUrls: readonly string[];

  /**
   * Convenience: the first entry of `rpcUrls`. Kept for callers
   * that only need a single URL (e.g. logging, debug display).
   * Not used for transport — see `create_rpc_provider.factory.ts`.
   */
  rpcUrl: string;

  explorerUrl?: string;

  nativeCurrency: TNativeCurrency;

  multicall3Address?: TAddress;
}
