// app/composables/useSessionState.ts

/**
 * Tiny client-only session-persistence helper. Phase 9 ships
 * "remember the user's last selection across reloads" without
 * pulling in `@vueuse/core` — localStorage with a defensive
 * try/catch + SSR guard is enough for the two keys we need:
 *
 *   - `lp:lastChainId`     — last chain id the user picked
 *   - `lp:lastProtocolId`  — last adapter they used
 *
 * Rules
 * -----
 *
 *   - **Client-only.** `window` and `localStorage` don't exist on
 *     the server. All reads default to `null`/`undefined` until
 *     the composable is called from inside `<ClientOnly>` (which
 *     is exactly where Phase 8 already mounts these values).
 *
 *   - **Read once on mount.** We don't `watch` storage from
 *     other tabs — single-tab app, no cross-tab sync needed.
 *     Writes happen eagerly via `set(...)` so the next reload
 *     sees the latest.
 *
 *   - **Keys are versioned.** `lp:v1:...` so we can change the
 *     shape later without colliding with old data.
 *
 * The composable does **not** validate the stored value against
 * `BUNDLED_NETWORKS` / `ADAPTER_REGISTRY`. The consuming page
 * does that (and falls back to defaults if the stored value
 * points at a chain we no longer bundle).
 */

const STORAGE_PREFIX = 'lp:v1:';

function safeGet<T>(key: string): T | null {
  if (!import.meta.client) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  }
  catch {
    return null;
  }
}

function safeSet<T>(key: string, value: T): void {
  if (!import.meta.client) return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  }
  catch {
    // Quota exceeded, private mode, etc. — silently ignore. The
    // session will simply reset on next reload.
  }
}

function safeRemove(key: string): void {
  if (!import.meta.client) return;
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + key);
  }
  catch {
    // same as above
  }
}

/**
 * Allowed values for the chart's history-window selector. We keep
 * the set small + explicit (vs. accepting any number) so the
 * `USelect` in `ChartsTab.vue` can't get out of sync with what the
 * use case knows how to render.
 */
export const HISTORY_WINDOW_DAYS = [14, 30, 90] as const;
export type THistoryWindowDays = typeof HISTORY_WINDOW_DAYS[number];
const DEFAULT_HISTORY_WINDOW_DAYS: THistoryWindowDays = 14;

function isHistoryWindowDays(n: unknown): n is THistoryWindowDays {
  return typeof n === 'number'
    && (HISTORY_WINDOW_DAYS as readonly number[]).includes(n);
}

export interface ISessionState {
  /** Last chain id the user picked, or `null` if never stored. */
  lastChainId: Ref<number | null>;
  /** Last protocol id (adapter) the user picked, or `null`. */
  lastProtocolId: Ref<string | null>;
  /** Chart history window in days (default 14). */
  historyWindowDays: Ref<THistoryWindowDays>;
  /** Persist a new chain id. */
  setChainId: (chainId: number) => void;
  /** Persist a new protocol id. */
  setProtocolId: (protocolId: string) => void;
  /** Persist a new chart history window. */
  setHistoryWindowDays: (days: THistoryWindowDays) => void;
  /** Wipe both keys (used when a stored value fails validation). */
  clear: () => void;
}

/**
 * Read the persisted values once (lazily, on first call from a
 * client context) and return reactive refs + setters. Calling
 * this from SSR is safe — the refs simply stay `null` and the
 * setters are no-ops.
 */
export function useSessionState(): ISessionState {
  const lastChainId = ref<number | null>(safeGet<number>('lastChainId'));
  const lastProtocolId = ref<string | null>(safeGet<string>('lastProtocolId'));
  const storedDays = safeGet<number>('historyWindowDays');
  const historyWindowDays = ref<THistoryWindowDays>(
    isHistoryWindowDays(storedDays) ? storedDays : DEFAULT_HISTORY_WINDOW_DAYS,
  );

  function setChainId(chainId: number) {
    lastChainId.value = chainId;
    safeSet('lastChainId', chainId);
  }

  function setProtocolId(protocolId: string) {
    lastProtocolId.value = protocolId;
    safeSet('lastProtocolId', protocolId);
  }

  function setHistoryWindowDays(days: THistoryWindowDays) {
    historyWindowDays.value = days;
    safeSet('historyWindowDays', days);
  }

  function clear() {
    lastChainId.value = null;
    lastProtocolId.value = null;
    historyWindowDays.value = DEFAULT_HISTORY_WINDOW_DAYS;
    safeRemove('lastChainId');
    safeRemove('lastProtocolId');
    safeRemove('historyWindowDays');
  }

  return {
    lastChainId: readonly(lastChainId),
    lastProtocolId: readonly(lastProtocolId),
    historyWindowDays: readonly(historyWindowDays),
    setChainId,
    setProtocolId,
    setHistoryWindowDays,
    clear,
  };
}
