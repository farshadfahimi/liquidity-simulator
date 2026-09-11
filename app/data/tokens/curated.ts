// app/data/tokens/curated.ts

/**
 * Curated, static token list for each bundled chain. The Discover
 * form's "Token A" / "Token B" dropdowns read from this map via
 * `useTokenList()`.
 *
 * Scope
 * -----
 *
 *   - **Bundled chains only.** Only `BUNDLED_NETWORKS` (Ethereum,
 *     Arbitrum, Base, Sonic) are listed. New chains need an entry
 *     here before the selector can populate.
 *
 *   - **Cold-start fallback for the dynamic fetch.** The
 *     `useTokenList` composable seeds the dropdown from this map
 *     so the user sees options instantly, then upgrades to the
 *     per-adapter dynamic source (Uniswap default token list /
 *     Shadow API) in the background and re-populates when the
 *     fetch resolves. If the fetch fails (offline, 429, CORS
 *     block) the curated list is what the user sees — the
 *     dropdown is never empty in practice.
 *
 *   - **Per-chain, not per-protocol.** The current adapter registry
 *     has at most one protocol per chain (Sonic: Shadow; the rest:
 *     Uniswap V3), and the dynamic source is selected by
 *     `protocolId` (so each protocol owns its own token universe).
 *     The curated list is the safety net that *isn't* protocol-
 *     specific; the dynamic source does the protocol-specific work.
 *
 *   - **Stablecoin + native + a couple of favourites per chain.**
 *     Kept small (~24 rows total) because it's now the fallback
 *     layer — the dynamic source is the long tail.
 *
 * Lives in `app/data/` (not `app/core/`) because the icon URL is a
 * UI concern — the Core stays protocol/UI-agnostic.
 *
 * `ITokenRow` is re-exported here as a *type* alias for `TTokenRow`
 * (defined in `app/core/shared/types/token_source.type.ts` and
 * re-exported from `@core/shared/types`). Old import paths
 * (`import type { ITokenRow } from '~/data/tokens/curated'`)
 * keep working unchanged.
 */

import type { TAddress, TTokenRow } from '@core/shared/types';

/**
 * @deprecated Prefer `TTokenRow` from `@core/shared/types`. Kept
 * here as a type alias so existing imports of the form
 * `import type { ITokenRow } from '~/data/tokens/curated'`
 * continue to compile.
 */
export type ITokenRow = TTokenRow;

/**
 * Logo URL builder. Centralized so the chain slug mapping lives
 * in one place; if a chain is missing from this map the selector
 * shows no icon but the rest of the row still works.
 *
 * **Case note:** TrustWallet's CDN is *case-sensitive* on the
 * address segment — the lowercase form 404s. The curated list
 * below uses EIP-55 checksummed addresses (mixed case), which
 * is what the CDN expects. Do NOT `.toLowerCase()` here.
 */
function trustWalletLogo(
  chain: 'ethereum' | 'arbitrum' | 'base' | 'sonic',
  address: TAddress,
): string {
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chain}/assets/${address}/logo.png`;
}

/**
 * One row per known token on a given chain. Order in the array is
 * the order shown in the dropdown — most-liquid first, then by
 * market-cap intuition. Stablecoins are listed first on every
 * chain because they're the most common tokenA/tokenB choice.
 */
export const TOKEN_LISTS: Readonly<Record<number, readonly ITokenRow[]>> = Object.freeze({
  // -------------------------------------------------------------
  // Ethereum mainnet (chainId 1) — Uniswap V3.
  // -------------------------------------------------------------
  1: [
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin',         decimals: 6  },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD',       decimals: 6  },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI',  name: 'Dai Stablecoin',   decimals: 18 },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'Wrapped Ether',    decimals: 18 },
    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', name: 'Wrapped BTC',      decimals: 8  },
    { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', name: 'ChainLink Token',  decimals: 18 },
    { address: '0x1f9840a85d5aF5bf1D1762F925BdADdC4201F984', symbol: 'UNI',  name: 'Uniswap',          decimals: 18 },
    { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', symbol: 'AAVE', name: 'Aave Token',       decimals: 18 },
  ].map((t) => ({ ...t, logoURI: trustWalletLogo('ethereum', t.address) })),

  // -------------------------------------------------------------
  // Arbitrum One (chainId 42161) — Uniswap V3.
  // -------------------------------------------------------------
  42161: [
    { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', name: 'USD Coin (native)', decimals: 6  },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', name: 'Tether USD',        decimals: 6  },
    { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI',  name: 'Dai Stablecoin',    decimals: 18 },
    { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', name: 'Wrapped Ether',     decimals: 18 },
    { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC', name: 'Wrapped BTC',       decimals: 8  },
    { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB',  name: 'Arbitrum',          decimals: 18 },
    { address: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', symbol: 'GMX',  name: 'GMX',               decimals: 18 },
  ].map((t) => ({ ...t, logoURI: trustWalletLogo('arbitrum', t.address) })),

  // -------------------------------------------------------------
  // Base (chainId 8453) — Uniswap V3.
  // -------------------------------------------------------------
  8453: [
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC',  name: 'USD Coin',              decimals: 6  },
    { address: '0xfde4C96c8593536E31C82244345f0E63e6EcA55C', symbol: 'USDT',  name: 'Tether USD',            decimals: 6  },
    { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI',   name: 'Dai Stablecoin',        decimals: 18 },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH',  name: 'Wrapped Ether',         decimals: 18 },
    { address: '0x0555E30da8f98308EdB7Bf3B14d178eb9747C236', symbol: 'cbBTC', name: 'Coinbase Wrapped BTC',  decimals: 8  },
  ].map((t) => ({ ...t, logoURI: trustWalletLogo('base', t.address) })),

  // -------------------------------------------------------------
  // Sonic (chainId 146) — Shadow CL.
  // -------------------------------------------------------------
  146: [
    { address: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894', symbol: 'USDC.e', name: 'USDC (bridged)',       decimals: 6  },
    { address: '0x6047828dc181963ba44974801FF68e538dA5eaF9', symbol: 'USDT',   name: 'Bridged USDT',         decimals: 6  },
    { address: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38', symbol: 'wS',     name: 'Wrapped Sonic',        decimals: 18 },
    { address: '0x50c42dEAcD8Fc9773493ED674b675bE577f2634b', symbol: 'WETH',   name: 'Wrapped Ether on Sonic', decimals: 18 },
  ].map((t) => ({ ...t, logoURI: trustWalletLogo('sonic', t.address) })),
});

/**
 * Convenience: return the curated list for a chain id, or
 * `[]` if the chain isn't bundled. The Discover form's
 * `USelectMenu` reads this and shows "no tokens" gracefully.
 */
export function tokensForChain(chainId: number): readonly ITokenRow[] {
  return TOKEN_LISTS[chainId] ?? [];
}

/**
 * Look up a single token by (chainId, address). Returns
 * `undefined` if either the chain is unknown or the address
 * isn't in the curated list. Used to render the default
 * selection (USDC/WETH) on first mount with the friendly
 * symbol even though the underlying value is the address.
 */
export function findToken(chainId: number, address: string): ITokenRow | undefined {
  const list = TOKEN_LISTS[chainId];
  if (!list) return undefined;
  const target = address.toLowerCase();
  return list.find((t) => t.address.toLowerCase() === target);
}
