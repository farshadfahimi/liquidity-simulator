// app/composables/useRpcOverride.ts

/**
 * Per-chain, user-pinned RPC URL overrides. This composable is
 * the **runtime** mechanism that lets end users pin a personal
 * endpoint (Alchemy / Infura / private node) through the UI's
 * settings drawer on the Discover page. It is the *only* RPC
 * override path — there is no env-var escape hatch.
 *
 * Storage shape
 * -------------
 *
 *   `lp:v1:rpcOverrides` → `Record<number, string>`
 *
 *   Keys are chain ids (1, 42161, 8453, 146). Values are full
 *   URLs (`https://...`). The plugin at `app/plugins/core.client.ts`
 *   reads this map at boot and prepends each override to the
 *   corresponding `TNetwork.rpcUrls` array, so user-pinned
 *   endpoints win over public fallbacks for that chain.
 *
 * Rules
 * -----
 *
 *   - **Client-only.** `window` and `localStorage` don't exist
 *     on the server. Calling this from SSR is safe — the
 *     returned map is empty and setters are no-ops.
 *
 *   - **Read once on mount.** Single-tab app, no cross-tab sync.
 *
 *   - **Keys are versioned.** `lp:v1:rpcOverrides` so we can
 *     change the shape later without colliding with old data.
 *
 *   - **Defensive.** Every read/write is wrapped in a try/catch
 *     so quota errors / private-mode browsers degrade silently
 *     to "no override".
 *
 *   - **Validation is the caller's job.** This composable does
 *     not validate URLs (that's the form's responsibility) or
 *     resolve chain ids against the bundled networks (that's
 *     the plugin's responsibility).
 */

const STORAGE_KEY = 'rpcOverrides';

export interface IRpcOverride {
  /**
   * Reactive map of `chainId → user-pinned URL`. Read-only;
   * mutate via `setOverride` / `clearOverride` / `clearAll`.
   */
  readonly overrides: Readonly<Ref<Record<number, string>>>;
  /** Look up the override for a single chain (or `''` if none). */
  getOverride: (chainId: number) => string;
  /** Pin a URL for a chain. Empty string clears it. */
  setOverride: (chainId: number, url: string) => void;
  /** Clear the override for a single chain. */
  clearOverride: (chainId: number) => void;
  /** Wipe every override (used by a future "Reset all" button). */
  clearAll: () => void;
}

function safeGet(): Record<number, string> {
  if (!import.meta.client) return {};
  try {
    const raw = window.localStorage.getItem(
      `lp:v1:${STORAGE_KEY}`,
    );
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object'
      && parsed !== null
      && !Array.isArray(parsed)
    ) {
      // Coerce to the expected shape (drop bogus entries).
      const out: Record<number, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const id = Number(k);
        if (Number.isInteger(id) && typeof v === 'string' && v.length > 0) {
          out[id] = v;
        }
      }
      return out;
    }
    return {};
  }
  catch {
    return {};
  }
}

function safeSet(value: Record<number, string>): void {
  if (!import.meta.client) return;
  try {
    window.localStorage.setItem(
      `lp:v1:${STORAGE_KEY}`,
      JSON.stringify(value),
    );
  }
  catch {
    // Quota exceeded, private mode, etc. — silently ignore.
  }
}

function safeRemove(): void {
  if (!import.meta.client) return;
  try {
    window.localStorage.removeItem(`lp:v1:${STORAGE_KEY}`);
  }
  catch {
    // same as above
  }
}

/**
 * Read the persisted overrides once (lazily, on first call from
 * a client context) and return a reactive map + setters. Calling
 * this from SSR is safe — the map is empty and setters are no-ops.
 */
export function useRpcOverride(): IRpcOverride {
  const overrides = ref<Record<number, string>>(safeGet());

  function getOverride(chainId: number): string {
    return overrides.value[chainId] ?? '';
  }

  function setOverride(chainId: number, url: string): void {
    const trimmed = url.trim();
    const next = { ...overrides.value };
    if (trimmed.length === 0) {
      delete next[chainId];
    }
    else {
      next[chainId] = trimmed;
    }
    overrides.value = next;
    safeSet(next);
  }

  function clearOverride(chainId: number): void {
    if (!(chainId in overrides.value)) return;
    const next = { ...overrides.value };
    delete next[chainId];
    overrides.value = next;
    safeSet(next);
  }

  function clearAll(): void {
    overrides.value = {};
    safeRemove();
  }

  return {
    overrides: readonly(overrides),
    getOverride,
    setOverride,
    clearOverride,
    clearAll,
  };
}
