// app/core/network/networks/sonic.const.ts

import { sonic } from 'viem/chains';

import type { TNetwork } from '@core/shared/types';

export const sonicNetwork: TNetwork = {
  id: sonic.id,

  name: sonic.name,

  // Phase 9: fallback list. Sonic's official RPC is CORS-friendly
  // but occasionally returns 5xx under load; the Ankr endpoint is
  // a known secondary. See AGENT.md §6.17.
  //
  // To override the list (e.g. with a private endpoint for
  // dev work), use the in-app RPC settings drawer on the
  // Discover page — that goes through `useRpcOverride` and
  // prepends to this list at plugin boot. There is no
  // env-var escape hatch.
  rpcUrls: [
    'https://rpc.soniclabs.com',
    'https://rpc.ankr.com/sonic_mainnet',
  ],

  rpcUrl: 'https://rpc.soniclabs.com',

  explorerUrl: sonic.blockExplorers?.default.url,

  nativeCurrency: {
    name: sonic.nativeCurrency.name,
    symbol: sonic.nativeCurrency.symbol,
    decimals: sonic.nativeCurrency.decimals,
  },

  /**
   * Canonical Multicall3 address on Sonic. Same as Ethereum
   * mainnet (`0xca11bde0...ca11`) — the mds1/mds1 canonical
   * deployment is chain-agnostic. Required so viem's
   * `multicall` action can resolve the contract on Sonic
   * without throwing `ChainDoesNotSupportContract`. See
   * AGENT.md §6.17.
   */
  multicall3Address: '0xca11bde05977b3631167028862be2a173976ca11',
};
