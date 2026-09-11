// app/core/adapters/sources/index.ts

import type { ITokenSource } from '@core/shared/types';

import { UniswapV3TokenSource } from '@core/adapters/uniswap/v3/sources/uniswap_v3_token_source';
import { ShadowTokenSource } from '@core/adapters/shadow/sources/shadow_token_source';

/**
 * Static, per-protocol token-source registry. Each adapter
 * that ships a token source registers one entry here. The
 * UI composable `useTokenList({ chainId, protocolId })`
 * resolves the source for the active `protocolId` and asks
 * it for the tokens.
 *
 * Why a hand-rolled registry (and not reflection over the
 * adapter classes themselves)?
 * ---------------------------------------------------------
 *
 *   - **Adapters are heavy.** The `UniswapV3Adapter` takes
 *     an `IRpcProvider`; we don't want the source layer to
 *     depend on adapter construction. Sources are pure data
 *     fetchers — no RPC, no viem, no SDK.
 *
 *   - **Sources may outnumber adapters.** A future "Etherscan
 *     enrichment" source or a "favorites overlay" source
 *     could attach to a protocol without changing the
 *     adapter. The composable is the right place to compose
 *     them; the registry is the right place to enumerate.
 *
 *   - **One-line fallback.** If a protocol didn't ship a
 *     source, `resolveTokenSource(protocolId)` returns
 *     `undefined` and the composable uses the curated list
 *     alone. No try/catch, no thrown error.
 *
 * The shape is `Record<protocolId, ITokenSource>` — the
 * key is the same string the adapter uses for `id` and the
 * composable's `protocolId` input. They are not the same
 * TypeScript type (`TProtocolId` is the union of registered
 * protocol ids; this map is wider because sources can be
 * added without updating the type), so the lookup is typed
 * as `Record<string, ITokenSource>`.
 */
export const tokenSources: Readonly<Record<string, ITokenSource>> = Object.freeze({
  'uniswap-v3': new UniswapV3TokenSource(),
  'shadow-cl': new ShadowTokenSource(),
});

/**
 * Look up a token source by `protocolId`. Returns
 * `undefined` if the protocol hasn't shipped a source —
 * the composable layer falls back to the curated list in
 * that case.
 */
export function resolveTokenSource(protocolId: string): ITokenSource | undefined {
  return tokenSources[protocolId];
}
