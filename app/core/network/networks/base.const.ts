// app/core/network/networks/base.const.ts

import { base } from 'viem/chains';

import type { TNetwork } from '@core/shared/types';

export const baseNetwork: TNetwork = {
  id: base.id,

  name: base.name,

  // Phase 9: fallback list. mainnet.base.org is the official
  // endpoint and is CORS-friendly; PublicNode + Ankr are
  // fallbacks. See AGENT.md §6.17.
  //
  // To override the list (e.g. with an Alchemy/Infura key for
  // dev work), use the in-app RPC settings drawer on the
  // Discover page — that goes through `useRpcOverride` and
  // prepends to this list at plugin boot. There is no
  // env-var escape hatch.
  rpcUrls: [
    'https://mainnet.base.org',
    'https://base-rpc.publicnode.com',
    'https://rpc.ankr.com/base',
  ],

  rpcUrl: 'https://mainnet.base.org',

  explorerUrl: base.blockExplorers?.default.url,

  nativeCurrency: {
    name: base.nativeCurrency.name,
    symbol: base.nativeCurrency.symbol,
    decimals: base.nativeCurrency.decimals,
  },

  /**
   * Canonical Multicall3 address on Base. Same as Ethereum
   * mainnet (`0xca11bde0...ca11`) — the mds1/mds1 canonical
   * deployment is chain-agnostic. Required so viem's
   * `multicall` action can resolve the contract on Base
   * without throwing `ChainDoesNotSupportContract`. See
   * AGENT.md §6.17.
   */
  multicall3Address: '0xca11bde05977b3631167028862be2a173976ca11',
};
