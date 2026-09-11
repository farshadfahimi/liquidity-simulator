// app/core/network/networks/arbitrum.const.ts

import { arbitrum } from 'viem/chains';

import type { TNetwork } from '@core/shared/types';

export const arbitrumNetwork: TNetwork = {
  id: arbitrum.id,

  name: arbitrum.name,

  // Phase 9: fallback list. The official arb1 endpoint is fine
  // but rate-limits under burst; PublicNode + Ankr are CORS-safe
  // fallbacks. See AGENT.md §6.17.
  //
  // To override the list (e.g. with an Alchemy/Infura key for
  // dev work), use the in-app RPC settings drawer on the
  // Discover page — that goes through `useRpcOverride` and
  // prepends to this list at plugin boot. There is no
  // env-var escape hatch.
  rpcUrls: [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://rpc.ankr.com/arbitrum',
  ],

  rpcUrl: 'https://arb1.arbitrum.io/rpc',

  explorerUrl: arbitrum.blockExplorers?.default.url,

  nativeCurrency: {
    name: arbitrum.nativeCurrency.name,
    symbol: arbitrum.nativeCurrency.symbol,
    decimals: arbitrum.nativeCurrency.decimals,
  },

  /**
   * Canonical Multicall3 address on Arbitrum One. Same address
   * as Ethereum mainnet (`0xca11bde0...ca11`) because the
   * mds1/mds1 canonical deployment is chain-agnostic. Required
   * so viem's `multicall` action can resolve the contract —
   * without this, viem refuses the call with
   * `ChainDoesNotSupportContract`. See AGENT.md §6.17.
   */
  multicall3Address: '0xca11bde05977b3631167028862be2a173976ca11',
};
