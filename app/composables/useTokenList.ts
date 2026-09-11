// app/composables/useTokenList.ts

/**
 * Reactive accessor for the active chain's token universe.
 * Powers the Discover form's `TokenSelect` dropdowns.
 *
 * Cold start → curated
 * --------------------
 *
 * The composable starts by reading the static curated list
 * (`app/data/tokens/curated.ts`) so the dropdown is populated
 * instantly. The user never sees an empty selector on first
 * load, even if the dynamic source is rate-limiting or down.
 *
 * Then — if a token source is registered for the active
 * `protocolId` and the chain is in `source.supportedChainIds`
 * — we kick off a background fetch, swap the ref to the
 * dynamic result on success, and persist the result in
 * `localStorage` for 24 hours.
 *
 * On failure (network, CORS, schema mismatch) we keep the
 * curated list and log a `console.warn`. The dropdown is
 * never empty in practice.
 *
 * Cache
 * -----
 *
 *   - key: `lp:v1:tokens:{protocolId}:{chainId}`
 *   - value: `{ fetchedAt: number, tokens: TTokenRow[] }`
 *   - TTL: 24h. A manual `refresh()` bypasses the cache.
 *
 * `refresh()` returns a `Promise<boolean>` so the caller can
 * toast on success / show a spinner on failure.
 */

import type { ComputedRef, Ref } from 'vue';
import type { TTokenRow } from '@core/shared/types';

import { findToken, tokensForChain } from '~/data/tokens/curated';
import { resolveTokenSource } from '@core/adapters/sources';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STORAGE_PREFIX = 'lp:v1:tokens:';

export interface IUseTokenList {
  /**
   * Reactive list of tokens for the active `(chainId, protocolId)`.
   * Starts as the curated list; replaced in place when the
   * dynamic source resolves.
   */
  readonly tokens: Ref<readonly TTokenRow[]>;
  /** True while a dynamic fetch is in flight. Used to disable the "Refresh" button. */
  readonly isRefreshing: Readonly<Ref<boolean>>;
  /** Look up one token by (chainId, address) — searches the *current* ref, not the curated list. */
  getToken: (chainId: number, address: string) => TTokenRow | undefined;
  /**
   * Force a refetch, ignoring the cache. Resolves to `true`
   * on success (tokens ref was replaced), `false` on failure
   * (curated list kept). The caller is responsible for toasts.
   */
  refresh: () => Promise<boolean>;
}

interface ICachedPayload {
  fetchedAt: number;
  tokens: TTokenRow[];
}

function safeGet(key: string): ICachedPayload | null {
  if (!import.meta.client) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as ICachedPayload;
  }
  catch {
    return null;
  }
}

function safeSet(key: string, value: ICachedPayload): void {
  if (!import.meta.client) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  }
  catch {
    // Quota / private mode — silently drop. The next refresh
    // will hit the network again.
  }
}

export function useTokenList(input: {
  chainId: ComputedRef<number> | Ref<number>;
  protocolId: ComputedRef<string> | Ref<string>;
}): IUseTokenList {
  const chainIdRef = input.chainId;
  const protocolIdRef = input.protocolId;

  // -----------------------------------------------------------------
  // Core reactive state.
  // -----------------------------------------------------------------
  // Initialised with the curated list for the seed chain so the
  // first render already has rows. The seed values come from the
  // caller (the form) so SSR + client agree.
  const initialChainId = chainIdRef.value;
  const tokens = ref<readonly TTokenRow[]>(tokensForChain(initialChainId)) as Ref<readonly TTokenRow[]>;
  const isRefreshing = ref<boolean>(false);

  // -----------------------------------------------------------------
  // Per-(protocolId, chainId) cache.
  // -----------------------------------------------------------------
  function cacheKey(protocolId: string, chainId: number): string {
    return `${STORAGE_PREFIX}${protocolId}:${chainId}`;
  }

  function readCache(protocolId: string, chainId: number): readonly TTokenRow[] | null {
    const payload = safeGet(cacheKey(protocolId, chainId));
    if (!payload) return null;
    if (Date.now() - payload.fetchedAt > CACHE_TTL_MS) return null;
    if (!Array.isArray(payload.tokens)) return null;
    return payload.tokens;
  }

  function writeCache(protocolId: string, chainId: number, list: readonly TTokenRow[]): void {
    safeSet(cacheKey(protocolId, chainId), { fetchedAt: Date.now(), tokens: [...list] });
  }

  // -----------------------------------------------------------------
  // The actual fetch. Resolves with the fetched list (cache or
  // network); never throws — failures resolve to `null` so the
  // caller doesn't have to wrap in try/catch.
  // -----------------------------------------------------------------
  async function tryFetch(
    protocolId: string,
    chainId: number,
    opts: { bypassCache: boolean },
  ): Promise<readonly TTokenRow[] | null> {
    if (!protocolId) return null;

    const source = resolveTokenSource(protocolId);
    if (!source) return null;
    if (!source.supportedChainIds.includes(chainId)) return null;

    if (!opts.bypassCache) {
      const cached = readCache(protocolId, chainId);
      if (cached) return cached;
    }

    try {
      const list = await source.fetchTokens(chainId);
      // Defensive: skip writes if the source returned an empty list
      // (a misbehaving source shouldn't wipe the cache for the
      // next cold start).
      if (list.length === 0) return null;
      writeCache(protocolId, chainId, list);
      return list;
    }
    catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[useTokenList] dynamic fetch failed for ${protocolId}/${chainId}:`, err);
      return null;
    }
  }

  // -----------------------------------------------------------------
  // Reactive glue. Re-seed curated + try to upgrade from the
  // dynamic source whenever chainId or protocolId changes.
  // -----------------------------------------------------------------
  let inFlightKey: string | null = null;

  watch(
    [chainIdRef, protocolIdRef],
    async ([chainId, protocolId]) => {
      // Always start by re-seeding the curated list so the
      // dropdown reflects the new chain immediately, even if
      // the previous chain's dynamic list is still in the ref.
      tokens.value = tokensForChain(chainId);

      if (!protocolId) return;

      const key = `${protocolId}:${chainId}`;
      if (inFlightKey === key) return; // already running
      inFlightKey = key;

      isRefreshing.value = true;
      try {
        const fetched = await tryFetch(protocolId, chainId, { bypassCache: false });
        if (fetched && inFlightKey === key) {
          tokens.value = fetched;
        }
      }
      finally {
        if (inFlightKey === key) inFlightKey = null;
        isRefreshing.value = false;
      }
    },
    { immediate: true },
  );

  // -----------------------------------------------------------------
  // Manual refresh: bypass the cache, refetch, swap.
  // -----------------------------------------------------------------
  async function refresh(): Promise<boolean> {
    const protocolId = protocolIdRef.value;
    const chainId = chainIdRef.value;
    if (!protocolId) return false;

    isRefreshing.value = true;
    try {
      const fetched = await tryFetch(protocolId, chainId, { bypassCache: true });
      if (fetched) {
        tokens.value = fetched;
        return true;
      }
      return false;
    }
    finally {
      isRefreshing.value = false;
    }
  }

  // -----------------------------------------------------------------
  // getToken: look up in the *current* ref. After the dynamic
  // fetch upgrades, getToken sees the new tokens too.
  // -----------------------------------------------------------------
  function getToken(chainId: number, address: string): TTokenRow | undefined {
    // Try the active ref first (covers the dynamic case).
    const target = address.toLowerCase();
    const hit = tokens.value.find((t) => t.address.toLowerCase() === target);
    if (hit) return hit;
    // Fall back to the curated list (covers cross-chain lookups
    // where the ref is scoped to the active chain).
    return findToken(chainId, address);
  }

  return {
    tokens: readonly(tokens),
    isRefreshing: readonly(isRefreshing),
    getToken,
    refresh,
  };
}
