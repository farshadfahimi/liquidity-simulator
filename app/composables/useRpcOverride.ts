// app/composables/useRpcOverride.ts

/**
 * Per-chain user-pinned RPC configuration. This composable is
 * the **runtime** mechanism that lets end users pin a personal
 * endpoint (Alchemy / Infura / Tenderly fork / private node)
 * through the UI's settings drawer on the Discover page. It is
 * the *only* RPC override path — there is no env-var escape hatch.
 *
 * Phase 11 — access-key slice
 * ---------------------------
 *
 * The original slice 4 stored a single URL per chain. Phase 11
 * adds support for paid providers that authenticate via HTTP
 * header (`x-api-key`, `Authorization: Bearer …`, etc.), which
 * means we now also need to persist a *header map* alongside
 * the URL.
 *
 * To keep the on-disk shape a single object (no two parallel
 * keys to drift apart) the storage shape evolves to:
 *
 *   `lp:v1:rpcConfigs` →
 *     `Record<chainId, {
 *        preset?: string;     // "alchemy" | "infura" | "ankr" |
 *                             // "tenderly" | "custom"
 *        url?: string;        // resolved URL (after template
 *                             // expansion of `preset` + `key`)
 *        headers?: Record<string, string>;
 *                             // auth headers (Alchemy/Infura header
 *                             // mode, Tenderly, etc.)
 *        key?: string;        // user-pasted access key (kept so
 *                             // the form re-opens with the key
 *                             // visible when the user clicks
 *                             // "show"). Cleared by `clearConfig`.
 *      }>`
 *
 * Legacy data
 * -----------
 *
 * The pre-Phase-11 key was `lp:v1:rpcOverrides` with shape
 * `Record<chainId, string>` (a single URL). On first read in
 * Phase 11, we transparently migrate that data:
 *
 *   - Detect the legacy key.
 *   - Convert each `string` value into `{ url, preset: 'custom' }`.
 *   - Persist under the new key.
 *   - (Best-effort) delete the legacy key so we don't migrate
 *     twice. The legacy read still works as a fallback if the
 *     delete fails (private mode, quota, etc.).
 *
 * `safeGet()` always reads the *new* key first; only if that's
 * missing does it consult the legacy key. New writes always
 * touch the new key, never the legacy one.
 *
 * Rules (carried over from Phase 9)
 * ---------------------------------
 *
 *   - **Client-only.** `window` and `localStorage` don't exist
 *     on the server. Calling this from SSR is safe — the
 *     returned map is empty and setters are no-ops.
 *
 *   - **Read once on mount.** Single-tab app, no cross-tab sync.
 *
 *   - **Keys are versioned.** `lp:v1:rpcConfigs` so we can
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
 *
 *   - **No secrets leave the browser.** There is no backend.
 *     Keys sit in `localStorage` in plaintext because anything
 *     we'd encrypt with a JS-side key is trivially recoverable
 *     from devtools anyway. The UI masks the input field with
 *     `type="password"`.
 */

const STORAGE_KEY = 'rpcConfigs';
const LEGACY_STORAGE_KEY = 'rpcOverrides';

export interface IRpcConfig {
  /** Preset id (`alchemy` / `infura` / `ankr` / `tenderly` / `custom`). */
  preset?: string;

  /**
   * Resolved RPC URL after preset + key expansion. Empty string
   * when the chain has no override or the user cleared it.
   */
  url?: string;

  /** Auth headers to send with every request. */
  headers?: Readonly<Record<string, string>>;

  /**
   * Raw access key (kept so the form can re-display the key
   * when the user clicks "show"). Never returned by the public
   * getters; use `getConfig().key` only inside `RpcSettings.vue`.
   *
   * When the user clears the override, this field is dropped.
   */
  key?: string;
}

export interface IRpcOverride {
  /**
   * Reactive map of `chainId → user-pinned config`. Read-only;
   * mutate via `setConfig` / `clearConfig` / `clearAll`.
   */
  readonly configs: Readonly<Ref<Record<number, IRpcConfig>>>;

  /** Look up the full config for a single chain (or `{}` if none). */
  getConfig: (chainId: number) => IRpcConfig;

  /**
   * Legacy URL-only getter. Returns the URL the chain resolves
   * to (preset-expanded if a preset is set, raw URL if custom).
   * Empty string when no override exists.
   *
   * Kept for `RpcSettings.vue` and the plugin's `withOverride`
   * step. Prefer `getConfig()` for new code.
   */
  getOverride: (chainId: number) => string;

  /**
   * Legacy headers-only getter. Returns the chain's auth headers
   * or `{}` if none. Kept for symmetry with `getOverride`; new
   * code should read `getConfig(chainId).headers` directly.
   */
  getHeaders: (chainId: number) => Readonly<Record<string, string>>;

  /**
   * Pin a full RPC config for a chain. Passing an empty `url`
   * AND empty `headers` clears the override (same as
   * `clearConfig`).
   */
  setConfig: (chainId: number, config: IRpcConfig) => void;

  /**
   * Pin a single URL for a chain, treating it as a custom
   * (preset-less) override with no headers. Empty string clears
   * the override. Kept for backward compatibility with the
   * Phase 9 call sites; new code should prefer `setConfig`.
   */
  setOverride: (chainId: number, url: string) => void;

  /** Clear the override for a single chain. */
  clearOverride: (chainId: number) => void;

  /** Alias of {@link clearOverride} (Phase 11 naming). */
  clearConfig: (chainId: number) => void;

  /** Wipe every override (used by a future "Reset all" button). */
  clearAll: () => void;
}

/**
 * Normalize a raw decoded value into the new `IRpcConfig` shape.
 *
 * Accepts either the new shape (`{ preset?, url?, headers?, key? }`)
 * or the legacy shape (`string` — a plain URL).
 */
function coerceConfig(raw: unknown): IRpcConfig | null {
  if (typeof raw === 'string') {
    // Legacy entry. Treat as a custom-URL override.
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    return { preset: 'custom', url: trimmed };
  }

  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    const out: IRpcConfig = {};

    if (typeof r.preset === 'string' && r.preset.length > 0) {
      out.preset = r.preset;
    }

    if (typeof r.url === 'string' && r.url.length > 0) {
      out.url = r.url;
    }

    if (typeof r.key === 'string' && r.key.length > 0) {
      out.key = r.key;
    }

    if (
      typeof r.headers === 'object'
      && r.headers !== null
      && !Array.isArray(r.headers)
    ) {
      const hdrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.headers as Record<string, unknown>)) {
        if (typeof v === 'string' && v.length > 0) {
          hdrs[k] = v;
        }
      }
      if (Object.keys(hdrs).length > 0) out.headers = hdrs;
    }

    // Empty entries (nothing pinned) collapse to null so callers
    // don't accidentally render "saved (nothing)" UI states.
    if (
      out.preset === undefined
      && out.url === undefined
      && out.headers === undefined
      && out.key === undefined
    ) {
      return null;
    }

    return out;
  }

  return null;
}

/**
 * Coerce a whole parsed `localStorage` blob into the `configs`
 * map shape, dropping bogus entries.
 */
function coerceConfigs(raw: unknown): Record<number, IRpcConfig> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const out: Record<number, IRpcConfig> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(k);
    if (!Number.isInteger(id)) continue;
    const cfg = coerceConfig(v);
    if (cfg !== null) out[id] = cfg;
  }
  return out;
}

function safeGet(): Record<number, IRpcConfig> {
  if (!import.meta.client) return {};
  try {
    // -----------------------------------------------------------------
    // [1] Try the new (Phase 11) key first.
    // -----------------------------------------------------------------
    const rawNew = window.localStorage.getItem(
      `lp:v1:${STORAGE_KEY}`,
    );
    if (rawNew !== null) {
      return coerceConfigs(JSON.parse(rawNew));
    }

    // -----------------------------------------------------------------
    // [2] Fall back to the legacy (Phase 9) key and migrate in-place.
    // -----------------------------------------------------------------
    const rawLegacy = window.localStorage.getItem(
      `lp:v1:${LEGACY_STORAGE_KEY}`,
    );
    if (rawLegacy === null) return {};

    const legacy = coerceConfigs(JSON.parse(rawLegacy));
    if (Object.keys(legacy).length > 0) {
      // Persist to the new key so subsequent reads skip this path.
      safeSet(legacy);
    }
    // Best-effort legacy cleanup. If it fails (private mode /
    // quota) we simply migrate again next boot — harmless.
    try {
      window.localStorage.removeItem(`lp:v1:${LEGACY_STORAGE_KEY}`);
    }
    catch {
      /* ignore */
    }
    return legacy;
  }
  catch {
    return {};
  }
}

function safeSet(value: Record<number, IRpcConfig>): void {
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
    /* same as above */
  }
}

function isEmptyConfig(cfg: IRpcConfig): boolean {
  return (
    (cfg.url === undefined || cfg.url.length === 0)
    && (cfg.key === undefined || cfg.key.length === 0)
    && (cfg.headers === undefined || Object.keys(cfg.headers).length === 0)
    && (cfg.preset === undefined || cfg.preset.length === 0)
  );
}

/**
 * Read the persisted overrides once (lazily, on first call from
 * a client context) and return a reactive map + setters. Calling
 * this from SSR is safe — the map is empty and setters are no-ops.
 */
export function useRpcOverride(): IRpcOverride {
  const configs = ref<Record<number, IRpcConfig>>(safeGet());

  function getConfig(chainId: number): IRpcConfig {
    return configs.value[chainId] ?? {};
  }

  function getOverride(chainId: number): string {
    return configs.value[chainId]?.url ?? '';
  }

  function getHeaders(chainId: number): Readonly<Record<string, string>> {
    return configs.value[chainId]?.headers ?? {};
  }

  function setConfig(chainId: number, config: IRpcConfig): void {
    if (isEmptyConfig(config)) {
      clearConfig(chainId);
      return;
    }
    const next = { ...configs.value };
    next[chainId] = config;
    configs.value = next;
    safeSet(next);
  }

  function setOverride(chainId: number, url: string): void {
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      clearConfig(chainId);
      return;
    }
    setConfig(chainId, {
      preset: configs.value[chainId]?.preset ?? 'custom',
      url: trimmed,
      ...(configs.value[chainId]?.key
        ? { key: configs.value[chainId]!.key }
        : {}),
    });
  }

  function clearOverride(chainId: number): void {
    clearConfig(chainId);
  }

  function clearConfig(chainId: number): void {
    if (!(chainId in configs.value)) return;
    const next = { ...configs.value };
    delete next[chainId];
    configs.value = next;
    safeSet(next);
  }

  function clearAll(): void {
    configs.value = {};
    safeRemove();
  }

  return {
    configs: readonly(configs),
    getConfig,
    getOverride,
    getHeaders,
    setConfig,
    setOverride,
    clearOverride,
    clearConfig,
    clearAll,
  };
}
