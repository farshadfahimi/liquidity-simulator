// app/core/providers/market/defi_llama_map.const.ts

/**
 * Static maps between our world and DefiLlama's.
 *
 * DefiLlama names the same chain two different ways:
 *   - `coins.llama.fi` wants a **lowercase slug** (`ethereum`).
 *   - `yields.llama.fi` / `api.llama.fi` want a **capitalized name**
 *     (`Ethereum`, `OP Mainnet`).
 *
 * Getting either wrong returns an empty result rather than an error,
 * which is very easy to debug the hard way — hence the explicit map.
 *
 * Verified 2026-11-18 (TVL-ROADMAP §3.6).
 */

/** One chain, as DefiLlama sees it. */
export interface IDefiLlamaChain {
  /** Our chain id. */
  readonly chainId: number;

  /** Slug used by `coins.llama.fi` (lowercase). */
  readonly coinsSlug: string;

  /** Chain name used by `yields.llama.fi` / `api.llama.fi`. */
  readonly chainName: string;
}

/** Every chain DefiLlama knows that we also support. */
export const DEFI_LLAMA_CHAINS: readonly IDefiLlamaChain[] = [
  { chainId: 1, coinsSlug: 'ethereum', chainName: 'Ethereum' },
  { chainId: 42161, coinsSlug: 'arbitrum', chainName: 'Arbitrum' },
  { chainId: 8453, coinsSlug: 'base', chainName: 'Base' },
  { chainId: 146, coinsSlug: 'sonic', chainName: 'Sonic' },
  // Mapped for the future — not bundled as a network yet.
  { chainId: 10, coinsSlug: 'optimism', chainName: 'OP Mainnet' },
];

/**
 * Our adapter id → DefiLlama `project` slug.
 *
 * The yields index is keyed by *project*, so a Shadow pool (which is
 * a Uniswap V3 fork) lives under `shadow-exchange-clmm` and not
 * under `uniswap-v3`.
 */
export const DEFI_LLAMA_PROJECTS: Readonly<Record<string, string>> = {
  'uniswap-v3': 'uniswap-v3',
  'shadow-cl': 'shadow-exchange-clmm',
};

/**
 * Look up the DefiLlama chain descriptor for a chain id.
 *
 * @param chainId - Our chain id.
 * @returns The descriptor, or `undefined` for a chain DefiLlama
 *   doesn't know (the caller degrades gracefully).
 */
export function defiLlamaChain(chainId: number): IDefiLlamaChain | undefined {
  return DEFI_LLAMA_CHAINS.find((chain) => chain.chainId === chainId);
}

/**
 * Look up the DefiLlama project slug for one of our adapter ids.
 *
 * @param protocolId - Our adapter id (e.g. `shadow-cl`).
 * @returns The project slug, or `undefined` when the protocol isn't
 *   indexed by DefiLlama.
 */
export function defiLlamaProject(protocolId: string): string | undefined {
  return DEFI_LLAMA_PROJECTS[protocolId];
}
