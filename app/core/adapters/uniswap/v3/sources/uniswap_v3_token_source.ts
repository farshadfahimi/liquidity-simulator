// app/core/adapters/uniswap/v3/sources/uniswap_v3_token_source.ts

import type { TTokenRow, TChainId } from '@core/shared/types';
import type { ITokenSource } from '@core/shared/types';

/**
 * Token universe source for the Uniswap V3 adapter. Pulls the
 * community-maintained `default-token-list` (the same list the
 * Uniswap UI ships) from a CDN and filters to the active chain.
 *
 * Why a per-adapter source (and not 1inch / Coingecko / etc.)?
 * ------------------------------------------------------------
 *
 *   - **Correct scope.** Uniswap V3's "universe" is "every
 *     ERC-20 with a deployed V3 pool on this chain". The
 *     default token list is curated against exactly that
 *     definition; pulling from 1inch or Coingecko would add
 *     junk tokens with no pool.
 *
 *   - **No auth, CORS-friendly.** `raw.githubusercontent.com` is
 *     served by JSDelivr's free CDN when prefixed with the
 *     `cdn.jsdelivr.net` host, which returns
 *     `access-control-allow-origin: *`. The raw GitHub host
 *     also serves CORS for browser fetches.
 *
 *   - **Consistent shape.** Same `{ chainId, address, symbol,
 *     name, decimals, logoURI }` row that `useTokenList`
 *     already expects, so the composable layer doesn't need
 *     to know which source it's talking to.
 *
 * The source has no constructor arguments and no state; it's
 * effectively a pure function `chainId → Promise<TTokenRow[]>`.
 * Multiple instances are safe to create (one per `useTokenList`
 * subscription) but the composable layer instantiates a single
 * shared one.
 */
export class UniswapV3TokenSource implements ITokenSource {
  readonly protocolId = 'uniswap-v3';

  /** The default token list covers Ethereum / Arbitrum / Base. */
  readonly supportedChainIds: readonly TChainId[] = [1, 42161, 8453];

  /**
   * Per-chain URL templates. The `cdn.jsdelivr.net` host mirrors
   * `raw.githubusercontent.com` with a global CDN and is what
   * the cloudflare-fronted `tokens.uniswap.org` is *supposed*
   * to serve — the CDN path is the reliable one. We fall back
   * to the raw GitHub URL on JSDelivr 404 (shouldn't happen in
   * practice; defensive).
   */
  private readonly urls: Readonly<Record<TChainId, readonly string[]>> = {
    1: [
      'https://cdn.jsdelivr.net/gh/Uniswap/default-token-list@main/src/tokens/mainnet.json',
      'https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/mainnet.json',
    ],
    42161: [
      'https://cdn.jsdelivr.net/gh/Uniswap/default-token-list@main/src/tokens/arbitrum.json',
      'https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/arbitrum.json',
    ],
    8453: [
      'https://cdn.jsdelivr.net/gh/Uniswap/default-token-list@main/src/tokens/base.json',
      'https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/base.json',
    ],
  };

  async fetchTokens(chainId: TChainId): Promise<readonly TTokenRow[]> {
    const urls = this.urls[chainId];
    if (!urls) return [];

    // Try each URL in order; the first one that returns a 200
    // with a parseable body wins. This protects us against a
    // future CDN hiccup without coupling to retry/backoff.
    let lastError: unknown = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status} on ${url}`);
          continue;
        }
        const json = (await res.json()) as unknown;
        return parseUniswapList(json, chainId);
      }
      catch (err) {
        lastError = err;
        // try next URL
      }
    }
    throw lastError ?? new Error(`UniswapV3TokenSource: no URL succeeded for chainId=${chainId}`);
  }
}

/**
 * Parse the `default-token-list` per-chain JSON into our flat
 * `TTokenRow[]`. The list is an array of objects with
 * `chainId / address / name / symbol / decimals / logoURI`;
 * we filter to `chainId` (each per-chain file should already
 * be that chain only, but we filter defensively in case a
 * future PR mixes chains), strip non-EVM entries, and return.
 *
 * Per-row the shape is identical to `TTokenRow` — no field
 * mapping needed; we just narrow the types so downstream
 * consumers don't have to deal with `unknown`.
 */
function parseUniswapList(raw: unknown, chainId: TChainId): readonly TTokenRow[] {
  if (!Array.isArray(raw)) {
    throw new Error('UniswapV3TokenSource: expected JSON array');
  }

  const out: TTokenRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (Number(r.chainId) !== chainId) continue;
    if (typeof r.address !== 'string' || !r.address.startsWith('0x')) continue;
    if (typeof r.symbol !== 'string' || typeof r.name !== 'string') continue;
    if (typeof r.decimals !== 'number') continue;

    out.push({
      address: r.address as TTokenRow['address'],
      symbol: r.symbol,
      name: r.name,
      decimals: r.decimals,
      logoURI: typeof r.logoURI === 'string' ? r.logoURI : undefined,
    });
  }
  return out;
}
