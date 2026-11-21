// app/core/shared/types/token_source.type.ts

import type { TAddress } from './address.type';
import type { TChainId } from './chain_id.type';

/**
 * Behavior contract for a per-adapter token source. Each
 * protocol (Uniswap V3, Shadow CL, …) ships one of these;
 * the UI composable `useTokenList()` looks up the source for
 * the active `protocolId` and asks it for the tokens.
 *
 * Why per-adapter, not per-chain?
 * --------------------------------
 *
 * The natural source *is* the adapter's own token universe.
 *   - Uniswap V3 → https://tokens.uniswap.org (or JSDelivr mirror)
 *   - Shadow CL  → https://api.shadow.so/tokens
 *
 * A per-chain source (e.g. "always 1inch") would either miss
 * tokens Shadow knows about (1inch has only 35 Sonic tokens,
 * Shadow has 20k) or include tokens the active adapter doesn't
 * recognize. Adapters are the right unit of indirection.
 *
 * Pure data — implementations live in `app/core/adapters/<protocol>/sources/`
 * and are free to use `fetch()`, the Graph, or a static blob.
 * `ITokenSource` is UI-agnostic; the composable layer in
 * `app/composables/useTokenList.ts` adds caching, fallback,
 * and reactivity on top.
 */
export interface ITokenSource {
  /** Stable identifier. Same as the adapter's `protocolId`. */
  readonly protocolId: string;

  /**
   * The chain ids this source can serve. The composable checks
   * this before calling `fetchTokens` — out-of-scope chain ids
   * fall through to the curated list without making a network
   * request.
   */
  readonly supportedChainIds: readonly TChainId[];

  /**
   * Fetch the full token universe for `chainId`. Resolves with
   * `readonly TTokenRow[]` (the data-layer type — see
   * `TTokenRow` below for the `logoURI` extension). May
   * reject on network error, CORS failure, or schema mismatch;
   * the composable catches and falls back to the curated list
   * so the dropdown is never empty in practice.
   *
   * Implementations SHOULD cache aggressively (HTTP cache,
   * localStorage, in-memory). The composable also caches.
   */
  fetchTokens(
    chainId: TChainId,
  ): Promise<readonly TTokenRow[]>;
}

/**
 * UI-facing token row. The Core-agnostic `TToken` only has
 * `address / symbol / name / decimals`; the *data* layer (this
 * type) extends it with an optional `logoURI` so the selector
 * in `TokenSelect.vue` can render the icon. We don't want
 * `TToken` itself to know about icons — Core stays UI-free —
 * but the *data* layer is allowed to (it's where presentation
 * hints live, in the same way a DTO sometimes does).
 *
 * Kept in `app/core/shared` (not `app/components`) so the
 * source implementations can be unit-tested without dragging
 * in Nuxt UI.
 */
export interface TTokenRow {
  readonly address: TAddress;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  /**
   * Optional CDN URL for the token's icon. The selector
   * falls back to a generic dot if absent or 404. TrustWallet
   * is the canonical source — see `trustWalletLogo()` in
   * `app/data/tokens/curated.ts`.
   */
  readonly logoURI?: string;
}
