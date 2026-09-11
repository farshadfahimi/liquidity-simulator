// app/core/adapters/shadow/sources/shadow_token_source.ts

import type { TTokenRow, TChainId } from '@core/shared/types';
import type { ITokenSource } from '@core/shared/types';

/**
 * Token universe source for the Shadow CL adapter on Sonic
 * (chainId 146). Pulls the public list from Shadow's
 * analytics API and synthesizes a TrustWallet logo URL for
 * each row (Shadow's payload doesn't include `logoURI`).
 *
 * Notes on the upstream shape
 * ---------------------------
 *
 *   - **Sonic-only by definition.** Shadow only exists on
 *     Sonic, so the payload has no `chainId` field — every
 *     row is implicit chainId 146. `supportedChainIds` is
 *     the single-value `[146]`.
 *
 *   - **Very large.** ~20,000 rows. We forward the full list
 *     to the composable layer; the browser handles a 2.7 MB
 *     JSON fine for a one-shot fetch (24h localStorage cache
 *     afterwards).
 *
 *   - **Includes prices + APR.** The payload has `price`
 *     and `impliedAPR` fields. We *don't* surface them
 *     today — the selector's job is just to pick an address.
 *     They're documented in the field comments below in case
 *     a future "yield-bearing token" badge wants to read
 *     `impliedAPR` without re-fetching.
 *
 *   - **logoURI is synthesized.** TrustWallet's CDN is
 *     case-sensitive on the address segment — the source
 *     MUST NOT `.toLowerCase()` the address. The upstream
 *     payload's `id` is already EIP-55 checksummed.
 */
export class ShadowTokenSource implements ITokenSource {
  readonly protocolId = 'shadow-cl';

  readonly supportedChainIds: readonly TChainId[] = [146];

  async fetchTokens(chainId: TChainId): Promise<readonly TTokenRow[]> {
    if (chainId !== 146) return [];

    const res = await fetch('https://api.shadow.so/tokens', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`ShadowTokenSource: HTTP ${res.status} from upstream`);
    }
    const json = (await res.json()) as unknown;
    return parseShadowList(json);
  }
}

/**
 * `Shadow API row` — the unprocessed fields we care about
 * for the selector. `price` and `impliedAPR` are kept on the
 * row in case a future feature wants to read them.
 */
interface IShadowRow {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  price?: number;
  impliedAPR?: number | null;
}

/**
 * TrustWallet CDN URL for Sonic. Centralized here (not in
 * the curated list) because this source has no other
 * reasonable way to get a logoURI — the upstream payload
 * doesn't ship one.
 *
 * **Case note:** the CDN is case-sensitive on the address
 * segment. The upstream `id` is EIP-55 checksummed; do NOT
 * lowercase it.
 */
function sonicLogoURI(address: string): string {
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/sonic/assets/${address}/logo.png`;
}

function parseShadowList(raw: unknown): readonly TTokenRow[] {
  if (!Array.isArray(raw)) {
    throw new Error('ShadowTokenSource: expected JSON array from api.shadow.so/tokens');
  }

  const out: TTokenRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as IShadowRow;
    if (typeof r.id !== 'string' || !r.id.startsWith('0x')) continue;
    if (typeof r.symbol !== 'string' || typeof r.name !== 'string') continue;
    if (typeof r.decimals !== 'number') continue;

    out.push({
      address: r.id as TTokenRow['address'],
      symbol: r.symbol,
      name: r.name,
      decimals: r.decimals,
      logoURI: sonicLogoURI(r.id),
    });
  }
  return out;
}
