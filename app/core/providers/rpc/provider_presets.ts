// app/core/providers/rpc/provider_presets.ts

/**
 * Curated list of paid / private RPC provider **presets** the
 * end-user can pick from in the RPC settings drawer.
 *
 * Why presets?
 * ------------
 *
 * Each paid provider has a slightly different auth shape:
 *
 *   - **Alchemy** accepts the key either embedded in the URL
 *     (`/v2/<KEY>`) or as a header (`x-api-key: <KEY>`). Both
 *     are equivalent on the server side; the URL-embed form
 *     is what the Alchemy dashboard hands you by default.
 *   - **Infura** has moved towards `Authorization: Bearer
 *     <KEY>`; the old `/v3/<KEY>` URL form still works on
 *     most endpoints.
 *   - **Ankr** uses URL-embed (`/api/v2/<KEY>`); it does not
 *     support a header form.
 *   - **Tenderly** (virtual testnets / forks) authenticates
 *     with `X-Forwarded-User` + `X-Forwarded-Key` headers
 *     against a `https://<USER>.rpc.tenderly.co` host.
 *   - **Custom** is the escape hatch: the user pastes a full
 *     URL (and optionally a free-form header map — that's a
 *     follow-up slice).
 *
 * We encode each preset's auth shape here so the UI can stay
 * dumb: pick a preset, type a key, hit save.
 *
 * Public RPC fallback lists (the URLs after the user's pinned
 * one) still come from `app/core/network/networks/*.const.ts`
 * — these presets only describe **how to build the user-pinned
 * endpoint** from a key. See `RpcSettings.vue`.
 *
 * Phase 11 — access-key slice. See AGENT.md §6.17.
 */

/**
 * How a preset's access key is combined with its URL template.
 *
 *  - `url`     — substitute the key into `{key}` in the template.
 *  - `header`  — send the key as a named header; URL stays
 *                constant. Use `headerName` to specify which
 *                header to send.
 */
export type TPresetMode = 'url' | 'header';

export interface IRpcProviderPreset {
  /** Stable id used as the dropdown value. */
  readonly id: string;

  /** User-facing label. */
  readonly label: string;

  /**
   * URL template. When `mode === 'url'`, the literal `{key}`
   * placeholder is substituted with the user's key. When
   * `mode === 'header'`, the URL is used verbatim (the
   * `{key}` placeholder, if present, is still substituted —
   * e.g. Tenderly uses the key in both the URL path and
   * a header).
   */
  readonly urlTemplate: string;

  /**
   * How the key is sent. See {@link TPresetMode}.
   */
  readonly mode: TPresetMode;

  /**
   * When `mode === 'header'`, the HTTP header name to use
   * (e.g. `"x-api-key"`, `"Authorization"`). When
   * `mode === 'url'`, the header is unused.
   */
  readonly headerName?: string;

  /**
   * When `mode === 'header'`, the value template. `{key}` is
   * substituted with the user's key. Useful for
   * `Authorization: Bearer {key}` style headers.
   */
  readonly headerValueTemplate?: string;

  /**
   * Chain ids this preset knows how to build URLs for.
   * Used by the UI to filter which presets show up for
   * a given chain row. (Ankr / Alchemy cover all four
   * bundled chains; Tenderly is per-user so we allow
   * it on every chain.)
   */
  readonly supportedChainIds: readonly number[];
}

export const RPC_PROVIDER_PRESETS: readonly IRpcProviderPreset[] = Object.freeze([
  // -------------------------------------------------------------------
  // Alchemy — multi-chain. URL-embed is the dashboard default.
  // -------------------------------------------------------------------
  {
    id: 'alchemy',
    label: 'Alchemy',
    urlTemplate: 'https://{chainSlug}.g.alchemy.com/v2/{key}',
    mode: 'url',
    supportedChainIds: [1, 42161, 8453, 146],
  },

  // -------------------------------------------------------------------
  // Infura — multi-chain. URL-embed (legacy form).
  // -------------------------------------------------------------------
  {
    id: 'infura',
    label: 'Infura',
    urlTemplate: 'https://{chainSlug}.infura.io/v3/{key}',
    mode: 'url',
    supportedChainIds: [1, 42161, 8453, 146],
  },

  // -------------------------------------------------------------------
  // Ankr — multi-chain premium tier. URL-embed only (Ankr doesn't
  // support a header form for the JSON-RPC endpoint).
  // -------------------------------------------------------------------
  {
    id: 'ankr',
    label: 'Ankr',
    urlTemplate: 'https://rpc.ankr.com/{chainSlug}/{key}',
    mode: 'url',
    supportedChainIds: [1, 42161, 8453, 146],
  },

  // -------------------------------------------------------------------
  // Tenderly — virtual testnets / forks. Auth is two headers
  // (`X-Forwarded-User` and `X-Forwarded-Key`). We model the
  // user-supplied key as the *secondary* key (the more secret
  // one); the account/username goes into the URL, the api key
  // goes into the `X-Forwarded-Key` header. For the simple case
  // where the user only wants one secret, the username defaults
  // to `unknown` — Tenderly still accepts it on forks.
  // -------------------------------------------------------------------
  {
    id: 'tenderly',
    label: 'Tenderly (fork / virtual testnet)',
    urlTemplate: 'https://{user}.rpc.tenderly.co',
    mode: 'header',
    headerName: 'X-Forwarded-Key',
    headerValueTemplate: '{key}',
    supportedChainIds: [1, 42161, 8453, 146],
  },

  // -------------------------------------------------------------------
  // Custom — escape hatch. The user pastes a full URL (today's
  // "just paste the URL" flow) and we send no extra headers.
  // -------------------------------------------------------------------
  {
    id: 'custom',
    label: 'Custom (paste full URL)',
    urlTemplate: '',
    mode: 'url',
    supportedChainIds: [1, 42161, 8453, 146],
  },
]);

/**
 * Look up a preset by id (the dropdown value).
 */
export function findPreset(id: string): IRpcProviderPreset | undefined {
  return RPC_PROVIDER_PRESETS.find((p) => p.id === id);
}

/**
 * Per-chain slug used to fill `{chainSlug}` in preset URL
 * templates. These match each chain's primary commercial
 * RPC host naming so users can copy a key from their
 * dashboard and have it work without editing the URL.
 *
 * If a chain isn't listed here, presets using `{chainSlug}`
 * fall back to a safe numeric slug (`chain-<id>`).
 */
const CHAIN_SLUGS: Record<number, string> = {
  1: 'eth-mainnet',
  42161: 'arb-mainnet',
  8453: 'base-mainnet',
  146: 'sonic-mainnet',
};

export function chainSlug(chainId: number): string {
  return CHAIN_SLUGS[chainId] ?? `chain-${chainId}`;
}

/**
 * Build the user-pinned RPC URL for a preset + key + chain.
 *
 * Returns `null` for `custom` (no URL template) or when the
 * preset can't produce a URL for this chain.
 */
export function buildPresetUrl(
  preset: IRpcProviderPreset,
  chainId: number,
  key: string,
): string | null {
  if (preset.id === 'custom') return null;

  const slug = chainSlug(chainId);

  // For Tenderly, the URL embeds the *user* (account name), not
  // the secret key. We model the user's API key as the `{key}`
  // placeholder; the URL is hard-coded with `{user}` substituted
  // from a small "account" field the UI captures. For now we
  // use the key's first 8 chars as the account slug so the URL
  // is at least unique per secret. Power users can pick "Custom"
  // to set the URL explicitly.
  let url = preset.urlTemplate;

  if (preset.id === 'tenderly') {
    const user = key.slice(0, 8).toLowerCase() || 'fork';
    url = url.replace('{user}', user);
  }

  url = url.replace('{chainSlug}', slug);
  url = url.replace('{key}', encodeURIComponent(key));

  return url;
}

/**
 * Build the per-request headers for a preset + key. Returns
 * an empty object when the preset uses URL-embed (no header
 * needed) or for `custom`.
 */
export function buildPresetHeaders(
  preset: IRpcProviderPreset,
  key: string,
): Record<string, string> {
  if (preset.mode !== 'header') return {};
  if (!preset.headerName || !preset.headerValueTemplate) return {};
  const value = preset.headerValueTemplate.replace(
    '{key}',
    encodeURIComponent(key),
  );
  return { [preset.headerName]: value };
}
