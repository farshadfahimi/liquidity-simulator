// app/core/shared/utils/stablecoin.util.ts

/**
 * Stablecoin detection — the **anchor heuristic** used by the TVL
 * fallback chain (TVL-ROADMAP.md §8, tier 3).
 *
 * When a market-data provider gives us no USD price for either leg of
 * a pool we can still produce a USD *estimate* if one of the two
 * tokens is a dollar-pegged stable: anchor it at $1.00 and derive the
 * other leg's price from the pool's own on-chain price ratio.
 *
 * This is deliberately a **symbol** heuristic, not an address
 * registry:
 *
 *   - The Core layer stays chain-agnostic and IO-free — an address
 *     registry would need per-chain tables that belong to the
 *     adapter/UI layers.
 *   - A wrong guess only degrades the *label* of the number (the tier
 *     stays `on-chain-estimates`), it never corrupts the arithmetic:
 *     the derived leg is the pool's own price ratio either way.
 *
 * The list is intentionally conservative — only well-known, widely
 * used dollar-pegged assets. A token that is *not* on the list simply
 * means tier 3 is unavailable and the caller drops to tier 4
 * (`token-units`).
 */

/**
 * Symbols of tokens treated as USD-pegged ($1.00) anchors.
 *
 * Compared case-insensitively, after stripping a `.e` suffix (the
 * bridged-USDC convention on Arbitrum, e.g. `USDC.e`).
 */
export const STABLECOIN_SYMBOLS: readonly string[] = [
  'USDC',
  'USDT',
  'DAI',
  'USDS',
  'USDE',
  'USDD',
  'FDUSD',
  'TUSD',
  'BUSD',
  'FRAX',
  'LUSD',
  'GUSD',
  'PYUSD',
  'EURC',
  'CRVUSD',
  'GHO',
  'SUSD',
  'USD0',
  'USDX',
];

/**
 * Normalize a token symbol for stablecoin comparison: upper-case and
 * drop the bridged `.e` suffix.
 *
 * @param symbol - Raw token symbol as reported by the adapter.
 * @returns The normalized symbol.
 */
export function normalizeTokenSymbol(symbol: string): string {
  const upper = symbol.trim().toUpperCase();

  return upper.endsWith('.E') ? upper.slice(0, -2) : upper;
}

/**
 * Whether `symbol` belongs to a known USD-pegged stablecoin.
 *
 * @param symbol - Raw token symbol as reported by the adapter.
 * @returns `true` when the symbol is on {@link STABLECOIN_SYMBOLS}.
 */
export function isStablecoinSymbol(symbol: string): boolean {
  if (typeof symbol !== 'string' || symbol.length === 0) {
    return false;
  }

  return STABLECOIN_SYMBOLS.includes(normalizeTokenSymbol(symbol));
}
