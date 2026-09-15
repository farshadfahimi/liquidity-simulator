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

  /**
   * Optional HTTP headers attached to *every* request made
   * through this chain's RPC provider. Used for paid providers
   * that authenticate via header (Alchemy's `x-api-key`,
   * Infura's `Authorization: Bearer <KEY>`, Tenderly's
   * `X-Forwarded-User` / `X-Forwarded-Key`, private nodes
   * with bearer tokens). Empty / undefined for the bundled
   * public RPCs.
   *
   * When the user pins a key through `useRpcOverride`, the
   * plugin folds the resulting header map onto the chain's
   * `TNetwork.rpcHeaders` at boot (see `core.client.ts`).
   *
   * Phase 11 — added alongside the access-key slice of the
   * RPC override path. See AGENT.md §6.17.
   */
  rpcHeaders?: Readonly<Record<string, string>>;

  explorerUrl?: string;

  nativeCurrency: TNativeCurrency;

  multicall3Address?: TAddress;
}
