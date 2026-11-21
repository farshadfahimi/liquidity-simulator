// app/core/providers/market/defi_llama_market_data_provider.class.ts

import {
  toScaledBigint,
  toUsdBigint,
  toUsdPriceBigint,
  USD_PRICE_DECIMALS,
} from '@core/shared/utils';

import {
  DEFI_LLAMA_PROJECTS,
  defiLlamaChain,
  defiLlamaProject,
} from './defi_llama_map.const';

import type { IMarketDataProvider } from './market_data_provider.interface';
import type { IDefiLlamaChain } from './defi_llama_map.const';
import type {
  TAddress,
  TPoolLiquidity,
  TPoolTvlPoint,
  TTokenPrice,
} from '@core/shared/types';

/**
 * DefiLlama market-data provider (TVL-ROADMAP §3, slice 2).
 *
 * Three endpoints, three jobs:
 *
 * | Endpoint | Job | Shape |
 * |---|---|---|
 * | E1 `coins.llama.fi/prices/current/{chain}:{addr},…` | USD token prices | `{ coins: { "chain:addr": { price, confidence, timestamp } } }` |
 * | E2 `yields.llama.fi/pools` | per-pool TVL + 24 h volume | `{ data: [ { chain, project, pool, tvlUsd, volumeUsd1d, poolMeta, underlyingTokens } ] }` |
 * | E3 `yields.llama.fi/chart/{poolId}` | per-pool TVL history | `{ data: [ { timestamp, tvlUsd } ] }` |
 *
 * Three facts drive the whole design (all verified live, see
 * TVL-ROADMAP §3.3 / §3.7):
 *
 * 1. **E2 cannot be filtered server-side** — query parameters are
 *    ignored and the full index is ~10.4 MB. The index is therefore
 *    fetched **lazily, at most once per hour**, and filtered
 *    client-side.
 * 2. **E2 pool ids are UUIDs**, never addresses. A pool is matched
 *    by its natural key — `(project, chain, token pair, fee tier)` —
 *    which is exactly the key the rest of the Core already uses.
 * 3. **The payload is JSON**, i.e. JS floats. Every number is
 *    converted to a bigint **here, at the boundary**, so no float
 *    ever crosses into the Core (TVL-ROADMAP §5.1).
 *
 * Degradation policy (TVL-ROADMAP §8): this provider **never throws
 * for "data unavailable"**. A network failure, a non-200 response or
 * an unparseable body yields `null` / `[]` so the caller can fall
 * back to the next tier (on-chain virtual reserves).
 */

const DEFI_LLAMA_ID = 'defi-llama';

const DEFI_LLAMA_NAME = 'DefiLlama';

const DEFI_LLAMA_VERSION = '1';

/** E1 — token prices. */
const COINS_URL = 'https://coins.llama.fi/prices/current';

/** E2/E3 — the yields index and the per-pool history. */
const YIELDS_URL = 'https://yields.llama.fi';

/** Prices move constantly — 60 s is short enough to be useful. */
const PRICE_TTL_SECONDS = 60n;

/**
 * The 10.4 MB index is the expensive call — refresh it once an hour
 * at most (TVL-ROADMAP §7).
 */
const INDEX_TTL_SECONDS = 3600n;

/** TVL history moves once a day — 10 min is plenty. */
const HISTORY_TTL_SECONDS = 600n;

/**
 * One entry of the yields index, reduced to the fields we use.
 *
 * The index ships ~15,290 entries; only the ones belonging to a
 * project we support (and carrying a parseable fee tier) are kept,
 * which keeps the in-memory index small.
 */
interface IPoolIndexEntry {
  /** DefiLlama project slug (`uniswap-v3`, `shadow-exchange-clmm`). */
  readonly project: string;

  /** DefiLlama chain name (`Base`, `Sonic`, …). */
  readonly chain: string;

  /** DefiLlama's own pool id — a UUID, used by the E3 history. */
  readonly externalPoolId: string;

  /** Total value locked, USD (float — converted at the boundary). */
  readonly tvlUsd: number;

  /** Rolling 24 h volume, USD; `null` when DefiLlama has no data. */
  readonly volume24hUsd: number | null;

  /** Fee tier in hundredths of a basis point (3000 = 0.3 %). */
  readonly fee: number;

  /** The pair, lower-cased and sorted. */
  readonly tokenA: string;

  /** The pair, lower-cased and sorted. */
  readonly tokenB: string;
}

/** A cached E1 answer. */
interface IPriceCacheEntry {
  readonly fetchedAt: bigint;
  readonly prices: readonly TTokenPrice[];
}

/** A cached E3 answer. */
interface IHistoryCacheEntry {
  readonly fetchedAt: bigint;
  readonly points: readonly TPoolTvlPoint[];
}

/**
 * Concrete {@link IMarketDataProvider} backed by DefiLlama's public
 * API (no key, CORS-open, browser-callable).
 *
 * The `fetch` implementation and the clock are injected so the
 * provider stays unit-testable without a network (AGENT.md §9.1).
 */
export class DefiLlamaMarketDataProvider implements IMarketDataProvider {
  readonly id = DEFI_LLAMA_ID;

  readonly name = DEFI_LLAMA_NAME;

  readonly version = DEFI_LLAMA_VERSION;

  private readonly fetchImpl: typeof fetch;

  private readonly now: () => bigint;

  /** The parsed E2 index, keyed by natural key. */
  private poolIndex: Map<string, IPoolIndexEntry> | null = null;

  /** When {@link poolIndex} was built (unix seconds). */
  private poolIndexFetchedAt = 0n;

  /** The in-flight E2 request, so two callers share one download. */
  private poolIndexRequest: Promise<Map<string, IPoolIndexEntry> | null> | null = null;

  private readonly priceCache = new Map<string, IPriceCacheEntry>();

  private readonly priceRequests = new Map<string, Promise<readonly TTokenPrice[]>>();

  private readonly historyCache = new Map<string, IHistoryCacheEntry>();

  private readonly historyRequests = new Map<string, Promise<readonly TPoolTvlPoint[] | null>>();

  /** `(chainId|pool)` → DefiLlama UUID, discovered while matching E2. */
  private readonly externalPoolIds = new Map<string, string>();

  constructor(opts: {
    /**
     * HTTP transport. Defaults to the global `fetch`; tests inject
     * a stub so no test ever touches the network.
     */
    readonly fetchImpl?: typeof fetch;

    /**
     * Clock, in unix **seconds**. Used for cache expiry and for the
     * `timestamp` of every snapshot.
     */
    readonly now?: () => bigint;
  } = {}) {
    // Wrapped in an arrow so the global `fetch` keeps its `this`
    // binding in the browser (an unbound `fetch` throws
    // "Illegal invocation").
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));

    this.now = opts.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  }

  async getTokenPrices(
    chainId: number,
    tokens: readonly TAddress[],
  ): Promise<readonly TTokenPrice[]> {
    const chain = defiLlamaChain(chainId);

    if (!chain || tokens.length === 0) {
      return [];
    }

    const cacheKey = priceCacheKey(chainId, tokens);
    const cached = this.priceCache.get(cacheKey);

    if (cached && this.now() - cached.fetchedAt < PRICE_TTL_SECONDS) {
      return cached.prices;
    }

    const inFlight = this.priceRequests.get(cacheKey);

    if (inFlight) {
      return inFlight;
    }

    const request = this.fetchTokenPrices(chain, tokens)
      .then((prices) => {
        this.priceCache.set(cacheKey, { fetchedAt: this.now(), prices });

        return prices;
      })
      .finally(() => {
        this.priceRequests.delete(cacheKey);
      });

    this.priceRequests.set(cacheKey, request);

    return request;
  }

  async getPoolLiquidity(
    chainId: number,
    protocolId: string,
    pool: TAddress,
    token0: TAddress,
    token1: TAddress,
    fee: number,
  ): Promise<TPoolLiquidity | null> {
    const chain = defiLlamaChain(chainId);
    const project = defiLlamaProject(protocolId);

    // Unknown chain or unknown protocol → DefiLlama can't know it
    // either. Degrade, never throw.
    if (!chain || !project) {
      return null;
    }

    const index = await this.getPoolIndex();

    if (!index) {
      return null;
    }

    const entry = index.get(
      poolIndexKey(project, chain.chainName, token0, token1, fee),
    );

    if (!entry) {
      return null;
    }

    // Remember the UUID so `getPoolTvlHistory` can find the chart
    // without re-matching (TVL-ROADMAP §7).
    this.externalPoolIds.set(poolExternalKey(chainId, pool), entry.externalPoolId);

    return {
      pool,
      chainId,
      protocolId,
      tvlUsd: toUsdBigint(entry.tvlUsd),
      volume24hUsd: entry.volume24hUsd === null
        ? 0n
        : toUsdBigint(entry.volume24hUsd),
      externalPoolId: entry.externalPoolId,
      source: 'defi-llama',
      timestamp: this.now(),
    };
  }

  async getPoolTvlHistory(
    chainId: number,
    pool: TAddress,
  ): Promise<readonly TPoolTvlPoint[] | null> {
    const externalPoolId = this.externalPoolIds.get(poolExternalKey(chainId, pool));

    // The index carries no addresses, so a pool that was never
    // matched has no UUID and therefore no history.
    if (!externalPoolId) {
      return null;
    }

    const cached = this.historyCache.get(externalPoolId);

    if (cached && this.now() - cached.fetchedAt < HISTORY_TTL_SECONDS) {
      return cached.points;
    }

    const inFlight = this.historyRequests.get(externalPoolId);

    if (inFlight) {
      return inFlight;
    }

    const request = this.fetchPoolTvlHistory(externalPoolId)
      .then((points) => {
        if (points) {
          this.historyCache.set(externalPoolId, { fetchedAt: this.now(), points });
        }

        return points;
      })
      .finally(() => {
        this.historyRequests.delete(externalPoolId);
      });

    this.historyRequests.set(externalPoolId, request);

    return request;
  }

  /**
   * Fetch the prices of `tokens` in **one** batched E1 call.
   *
   * Unknown tokens are simply absent from the answer — they are
   * omitted, never reported as an error.
   */
  private async fetchTokenPrices(
    chain: IDefiLlamaChain,
    tokens: readonly TAddress[],
  ): Promise<readonly TTokenPrice[]> {
    const requested = new Map<string, TAddress>();

    for (const token of tokens) {
      const key = token.toLowerCase();

      if (!requested.has(key)) {
        requested.set(key, token);
      }
    }

    const ids = [...requested.keys()].map(
      (address) => `${chain.coinsSlug}:${address}`,
    );

    const payload = await this.getJson(`${COINS_URL}/${ids.join(',')}`);

    if (!payload) {
      return [];
    }

    const coins = asRecord(asRecord(payload)?.['coins']);

    if (!coins) {
      return [];
    }

    const found = new Map<string, TTokenPrice>();

    for (const [rawKey, rawValue] of Object.entries(coins)) {
      const separator = rawKey.indexOf(':');

      if (separator === -1) {
        continue;
      }

      if (rawKey.slice(0, separator).toLowerCase() !== chain.coinsSlug) {
        continue;
      }

      const address = rawKey.slice(separator + 1).toLowerCase();
      const token = requested.get(address);

      if (!token) {
        continue;
      }

      const entry = asRecord(rawValue);

      if (!entry) {
        continue;
      }

      const price = asFiniteNumber(entry['price']);

      if (price === null) {
        continue;
      }

      const confidence = asFiniteNumber(entry['confidence']);
      const timestamp = asFiniteNumber(entry['timestamp']);

      found.set(address, {
        token,
        usdPrice: toUsdPriceBigint(price),
        confidence: confidence === null
          ? 0n
          : toScaledBigint(confidence, USD_PRICE_DECIMALS),
        timestamp: timestamp === null
          ? this.now()
          : BigInt(Math.floor(timestamp)),
      });
    }

    // Keep the caller's token order — deterministic, and easier to
    // assert on.
    return [...requested.keys()]
      .map((address) => found.get(address))
      .filter((price): price is TTokenPrice => price !== undefined);
  }

  /**
   * Download and index the E2 yields index.
   *
   * The index is fetched lazily (never on boot), at most once per
   * hour, and a single in-flight promise is shared by all callers.
   */
  private async getPoolIndex(): Promise<Map<string, IPoolIndexEntry> | null> {
    const cached = this.poolIndex;

    if (cached && this.now() - this.poolIndexFetchedAt < INDEX_TTL_SECONDS) {
      return cached;
    }

    if (this.poolIndexRequest) {
      return this.poolIndexRequest;
    }

    const request = this.fetchPoolIndex()
      .then((index) => {
        if (index) {
          this.poolIndex = index;
          this.poolIndexFetchedAt = this.now();
        }

        return index;
      })
      .finally(() => {
        this.poolIndexRequest = null;
      });

    this.poolIndexRequest = request;

    return request;
  }

  /** Download E2 and build the natural-key index. */
  private async fetchPoolIndex(): Promise<Map<string, IPoolIndexEntry> | null> {
    const payload = await this.getJson(`${YIELDS_URL}/pools`);

    if (!payload) {
      return null;
    }

    const data = asArray(asRecord(payload)?.['data']);

    if (!data) {
      return null;
    }

    const supportedProjects = new Set(Object.values(DEFI_LLAMA_PROJECTS));
    const index = new Map<string, IPoolIndexEntry>();

    for (const raw of data) {
      const entry = asRecord(raw);

      if (!entry) {
        continue;
      }

      const project = asString(entry['project']);
      const chain = asString(entry['chain']);
      const externalPoolId = asString(entry['pool']);
      const poolMeta = asString(entry['poolMeta']);
      const tokens = asArray(entry['underlyingTokens']);
      const tvlUsd = asFiniteNumber(entry['tvlUsd']);

      if (!project || !chain || !externalPoolId || !poolMeta || !tokens) {
        continue;
      }

      // Keep only the projects we actually support — the index
      // carries ~15k entries and we need ~1.7k of them.
      if (!supportedProjects.has(project)) {
        continue;
      }

      if (tokens.length < 2) {
        continue;
      }

      const tokenA = asString(tokens[0]);
      const tokenB = asString(tokens[1]);

      if (!tokenA || !tokenB) {
        continue;
      }

      if (tvlUsd === null) {
        continue;
      }

      const fee = parseDefiLlamaFee(poolMeta);

      if (fee === null) {
        continue;
      }

      const [low, high] = sortedTokens(tokenA, tokenB);

      const key = poolIndexKey(project, chain, tokenA, tokenB, fee);

      index.set(key, {
        project,
        chain,
        externalPoolId,
        tvlUsd,
        volume24hUsd: asFiniteNumber(entry['volumeUsd1d']),
        fee,
        tokenA: low,
        tokenB: high,
      });
    }

    return index;
  }

  /** Fetch the E3 TVL history of one (UUID-identified) pool. */
  private async fetchPoolTvlHistory(
    externalPoolId: string,
  ): Promise<readonly TPoolTvlPoint[] | null> {
    const payload = await this.getJson(`${YIELDS_URL}/chart/${externalPoolId}`);

    if (!payload) {
      return null;
    }

    const data = asArray(asRecord(payload)?.['data']);

    if (!data) {
      return null;
    }

    const points: TPoolTvlPoint[] = [];

    for (const raw of data) {
      const entry = asRecord(raw);

      if (!entry) {
        continue;
      }

      const timestamp = parseIsoTimestamp(asString(entry['timestamp']));
      const tvlUsd = asFiniteNumber(entry['tvlUsd']);

      if (timestamp === null || tvlUsd === null) {
        continue;
      }

      points.push({ timestamp, tvlUsd: toUsdBigint(tvlUsd) });
    }

    return points;
  }

  /**
   * GET a JSON document, degrading to `null` on any failure.
   *
   * Network errors, non-2xx responses and unparseable bodies are
   * all "data unavailable" here — they must not escape the provider
   * (TVL-ROADMAP §8).
   */
  private async getJson(url: string): Promise<unknown | null> {
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        return null;
      }

      const payload: unknown = await response.json();

      return payload;
    } catch {
      return null;
    }
  }
}

/**
 * Parse DefiLlama's `poolMeta` into hundredths of a basis point.
 *
 * `"0.05%" → 500`, `"0.3%" → 3000`, `"1%" → 10000`, `"0.01%" → 100`,
 * and Shadow's `"CL 0.24%" → 2400` (the `CL ` prefix marks a
 * concentrated-liquidity pool).
 *
 * The digits are parsed from the **string**, never via a float
 * multiplication: `0.3 * 10_000` is `3000.0000000000005` in
 * IEEE-754, and the fee tier has to match the on-chain value
 * exactly. Bigint arithmetic keeps it exact.
 *
 * @param poolMeta - The raw `poolMeta` field.
 * @returns The fee tier, or `null` when the value isn't a percentage.
 */
export function parseDefiLlamaFee(poolMeta: string): number | null {
  const cleaned = poolMeta.trim().replace(/^cl\s+/i, '');
  const match = /^(\d+)(?:\.(\d+))?%?/.exec(cleaned);

  if (!match) {
    return null;
  }

  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';

  // percent × 10 000 = hundredths of a basis point.
  const scaledFraction = BigInt(fraction === '' ? '0' : fraction) * 10_000n;
  const divisor = 10n ** BigInt(fraction.length);
  const rounded = (scaledFraction + divisor / 2n) / divisor;

  return Number(BigInt(whole) * 10_000n + rounded);
}

/**
 * The natural key of a pool in the E2 index.
 *
 * `(project, chain, token pair, fee tier)` — the project is part of
 * the key because two projects can list the *same* pair with the
 * *same* fee (a V2 and a V3 pool, say). The tokens are lower-cased
 * and sorted, so the order in which DefiLlama lists them doesn't
 * matter.
 */
function poolIndexKey(
  project: string,
  chainName: string,
  tokenA: string,
  tokenB: string,
  fee: number,
): string {
  const [low, high] = sortedTokens(tokenA, tokenB);

  return `${project}|${chainName.toLowerCase()}|${low}|${high}|${fee}`;
}

/**
 * The two tokens of a pair, lower-cased and sorted — so the order
 * in which DefiLlama lists them (or the caller passes them) doesn't
 * change the natural key.
 */
function sortedTokens(
  tokenA: string,
  tokenB: string,
): readonly [string, string] {
  const first = tokenA.toLowerCase();
  const second = tokenB.toLowerCase();

  return first <= second ? [first, second] : [second, first];
}

/** The cache key of one E1 batch. */
function priceCacheKey(
  chainId: number,
  tokens: readonly TAddress[],
): string {
  const ids = tokens.map((token) => token.toLowerCase()).sort();

  return `${chainId}|${ids.join(',')}`;
}

/** The key under which a pool's UUID is remembered. */
function poolExternalKey(chainId: number, pool: TAddress): string {
  return `${chainId}|${pool.toLowerCase()}`;
}

/**
 * Narrow an unknown JSON value to an object.
 *
 * The cast is safe because `typeof value === 'object' && !Array.isArray(value)`
 * guarantees a plain object at runtime.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

/** Narrow an unknown JSON value to an array. */
function asArray(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value as readonly unknown[];
}

/** Narrow an unknown JSON value to a string. */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Narrow an unknown JSON value to a finite number. */
function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Parse an ISO-8601 timestamp into unix seconds.
 *
 * E3 reports `"2023-12-03T23:05:17.943Z"` — the milliseconds are
 * dropped, the Core works in whole seconds.
 */
function parseIsoTimestamp(value: string | null): bigint | null {
  if (value === null) {
    return null;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return BigInt(Math.floor(parsed / 1000));
}
