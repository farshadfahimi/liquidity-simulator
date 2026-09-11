// app/core/network/networks/ethereum.const.ts

import { mainnet } from 'viem/chains';

import type { TNetwork } from '@core/shared/types';

export const ethereum: TNetwork = {
  id: mainnet.id,

  name: mainnet.name,

  // Phase 9: ordered fallback list. viem's `fallback` transport
  // cycles on transport-level failures (CORS, 5xx, timeout) but
  // does NOT retry on a successful response with empty data
  // (`0x`) — that's surfaced to the caller as
  // `ContractFunctionZeroDataError`. So the *order* matters:
  // we put a known-good, CORS-friendly, no-auth endpoint
  // (drpc.org) first, then layer paid-feeling fallbacks below.
  //
  //  - `eth.drpc.org`      — Cloudflare-fronted, CORS-friendly,
  //                          no auth, no rate limit on free tier
  //                          (as of Sep 2026).
  //  - `ethereum-rpc.publicnode.com` — publicnode's Ethereum
  //                          endpoint, CORS-friendly, stable.
  //  - `eth.merkle.io`     — merkle.io's free tier, occasionally
  //                          rate-limits but otherwise solid.
  //  - `cloudflare-eth.com`— Cloudflare's eth gateway, was the
  //                          first choice in slice 2 but has been
  //                          returning `-32603 Internal error` for
  //                          `eth_call` from many regions since
  //                          Sep 2026. Kept as a tertiary fallback.
  //
  // Endpoints removed (no longer viable in Sep 2026):
  //  - `https://eth.llamarpc.com` — `NetworkError` from browser.
  //  - `https://1rpc.io/eth`      — Nodies rate-limited
  //                                  (`-32005 Rate limit exceeded`).
  //  - `https://rpc.flashbots.net`— `eth_call` not whitelisted
  //                                  (`-32601 Method not allowed`).
  //
  // To override the list (e.g. with an Alchemy/Infura key for
  // dev work), use the in-app RPC settings drawer on the
  // Discover page — that goes through `useRpcOverride` and
  // prepends to this list at plugin boot. There is no
  // env-var escape hatch.
  rpcUrls: [
    'https://eth.drpc.org',
    'https://ethereum-rpc.publicnode.com',
    'https://eth.merkle.io',
    'https://cloudflare-eth.com',
  ],

  rpcUrl: 'https://eth.drpc.org',

  explorerUrl: mainnet.blockExplorers?.default.url,

  nativeCurrency: {
    name: mainnet.nativeCurrency.name,
    symbol: mainnet.nativeCurrency.symbol,
    decimals: mainnet.nativeCurrency.decimals,
  },

  /**
   * Canonical Multicall3 address on Ethereum mainnet. Required so the
   * viem `multicall` action can resolve the contract. Without this,
   * viem refuses the call with `ChainDoesNotSupportContract`.
   */
  multicall3Address: '0xca11bde05977b3631167028862be2a173976ca11',
};
