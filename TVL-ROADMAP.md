# TVL-ROADMAP — Adding TVL, Volume & USD Prices to analyze-web3

> Status: **Approved roadmap — not yet implemented**
> Owner data source: **DefiLlama public API** (no API key, CORS-open, browser-callable)
> All endpoints/shapes below were **verified live on 2026-11-18** with real calls
> (see §3.7 for the raw samples). Re-verify anything marked ⚠️ before relying on it.
> Related docs: `README.md` (§ Phase 9 backlog), `AGENT.md` (§3 dependency rules,
> §5.7b file placement, §10 Definition of Done, §11 testing).

---

## 0. TL;DR

| Question | Answer |
|---|---|
| Why TVL? | Today the recommendation engine scores every pool against a **hardcoded 30% APR prior** (`compare_strategies.use_case.ts`). TVL + volume turns that into a real, pool-specific fee APR: `APR ≈ volume × feeTier / TVL`. |
| Where does the data come from? | **DefiLlama**: per-pool TVL/APY/volume index (`yields.llama.fi/pools`), per-pool TVL history (`yields.llama.fi/chart/{id}`), token USD prices (`coins.llama.fi/prices/current/...`), protocol/chain volume context (`api.llama.fi/summary/dexs/{slug}`). |
| Where does it live in the code? | New provider `app/core/providers/market/` (HTTP-only, no viem) + new math `virtual_reserves.util.ts` / `fee_apr.util.ts` + domain enrichment on `Pool` / `AnalyticsEngine` + DTO/UI fields. Domains stay IO-free. |
| Can we always show a number? | Yes — **fallback chain**: DefiLlama per-pool → on-chain *virtual reserves* (from `liquidity` + `sqrtPriceX96` we already read) valued at DefiLlama token prices → stablecoin-anchored token-unit TVL (no network at all). |
| Rollout | 7 slices (§6). Slices 0–1 are dependency-free and shippable alone. |

---

## 1. Why TVL — the gap it closes

### 1.1 The hardcoded prior

```ts
// app/core/application/use_cases/compare_strategies.use_case.ts
const expectedApr = input.expectedApr ?? 3n * 10n ** 17n; // 30%
```

Every recommendation strategy (`Balanced`, `MaximumFee`, `HighestSharpe`) is built
on this constant (and `ScoringConfig.targetApr` re-carries it). The current ranking
is therefore a function of range width and assumed volatility — identical for a
$10k pool and a $500M pool.

### 1.2 What TVL (+ volume) unlocks, in order of impact

| # | Use | Lands in | Slice |
|---|---|---|---|
| 1 | Real **pool fee APR** replaces the 30% prior | `CompareStrategiesUseCase` → `expectedApr` | 4 |
| 2 | **Per-candidate expected fee APR**: `poolAPR × capitalEfficiency × P(in-range)` | `IRecommendationStrategy.score(..., context)` | 4 |
| 3 | **Position share of pool** — your $10k vs a $200k pool | `AnalyticsEngine`, simulation guard | 3 |
| 4 | **TVL trend** — liquidity flight = exit risk | charts tab (lightweight-charts v5) | 5 |
| 5 | **Risk floors** — `minTvlUsd` filter, thin-pool warnings | `ScoringConfig`, `LowestRiskStrategy` | 6 |
| 6 | **Pool discovery ranking** by TVL / volume-to-TVL | `DiscoverPoolsUseCase` + `DiscoverForm.vue` | 6 |
| 7 | **Depth / exit-impact proxy** for a deposit size | `AnalyticsEngine`, `DepositSimulation` | 6 |

### 1.3 What TVL must **never** be used for

- **IL math.** Impermanent loss stays purely price-based (as it is today). TVL
  affects *fee yield* and *exit risk*, never IL.
- **A score term that can dominate.** TVL is manipulable (one-sided positions,
  flash liquidity). Treat it as a floor/filter and a scaling denominator for
  fees — not as "bigger is proportionally better".

---

## 2. Scope & non-goals

**In scope**

- Per-pool TVL (USD), 24h volume (USD), token USD prices, per-pool TVL history.
- A new `IMarketDataProvider` abstraction + DefiLlama implementation.
- On-chain virtual-reserve TVL as the always-available fallback.
- Fee-APR math and its wiring into the recommendation engine + DTOs + UI.

**Non-goals (explicitly deferred)**

- Wallet / on-chain balance aggregation.
- Subgraph or archive-node TVL history (keep `IHistoryProvider` untouched).
- Other sources (GeckoTerminal, Coingecko) — the interface makes them a
  later drop-in (`createMarketDataProvider('gecko')`), but DefiLlama is the
  only implementation in this roadmap.
- TVL of *positions* (only pool-level TVL).

---

## 3. DefiLlama API — verified reference

All endpoints: **no API key**, **no auth header**, and all return
`access-control-allow-origin: *` (verified 2026-11-18) → directly callable
from the browser, no Nitro proxy needed.

### 3.1 Endpoint inventory

| # | Purpose | Endpoint | Size (verified) | Verdict |
|---|---|---|---|---|
| E1 | Token USD prices (batch) | `GET https://coins.llama.fi/prices/current/{chain}:{addr}[,{chain}:{addr}]` | ~165 B / token | ✅ primary price source |
| E2 | Per-pool TVL / APY / volume index | `GET https://yields.llama.fi/pools` | **10.4 MB**, 15,290 pools | ✅ per-pool TVL source — see §3.3 gotchas |
| E3 | Per-pool TVL/APY history | `GET https://yields.llama.fi/chart/{poolId}` | ~150 KB, ~950 points | ✅ TVL trend chart |
| E4 | Protocol TVL (+ per-chain) | `GET https://api.llama.fi/protocol/{slug}` | ~450 KB (uniswap-v3) | ✅ protocol context, per-chain TVL |
| E5 | Protocol DEX volume (+ per-chain 24h/7d/30d) | `GET https://api.llama.fi/summary/dexs/{slug}` | ~1.2 MB | ✅ volume context (protocol-level) |
| E6 | Full protocol payload | `GET https://api.llama.fi/updatedProtocol/{slug}` | 1.7 MB | ⚠️ not needed; skip |
| E7 | ~~DEX overview~~ | `GET https://api.llama.fi/overview/dexs/{slug}` | HTTP **500** | ❌ broken (verified) — do not use |
| E8 | ~~Fees overview~~ | `GET https://api.llama.fi/overview/fees/{slug}` | HTTP **500** | ❌ broken (verified) — do not use |
| E9 | ~~Per-chain DEX summary~~ | `GET https://api.llama.fi/summary/dexs/{slug}/{chain}` | HTTP **404** | ❌ no such route (verified) |

### 3.2 E1 — token prices (`coins.llama.fi`)

```
GET https://coins.llama.fi/prices/current/sonic:0x29219dd400f2bf60e5a23d13be72b486d4038894,base:0x4200000000000000000000000000000000000006
```

```jsonc
{
  "coins": {
    "sonic:0x29219dd400f2bf60e5a23d13be72b486d4038894": {
      "decimals": 6, "symbol": "USDC",
      "price": 0.9998438664500001,
      "timestamp": 1794998447, "confidence": 0.999
    },
    "base:0x4200000000000000000000000000000000000006": {
      "decimals": 18, "symbol": "WETH",
      "price": 1797.0162017200657,
      "timestamp": 1794998399, "confidence": 0.99
    }
  }
}
```

Notes:
- `price` is a JS float (USD). Convert to bigint **at the provider boundary**:
  `usdPriceScaled = BigInt(Math.round(price * 1e18))` → 1e18 fixed-point.
- `confidence` ∈ [0,1]; keep it, surface low-confidence prices in the UI later.
- Chain slugs are lowercase: `ethereum`, `arbitrum`, `base`, `sonic`
  (all four verified). Batch up to ~30 coins per call comfortably.
- If a token is unknown the key is simply **absent** from `coins` → return
  `null` for that token, do not throw.

### 3.3 E2 — the per-pool index (`yields.llama.fi/pools`) — the important gotchas

Verified response facts (2026-11-18):

- **10.4 MB**, 15,290 pool entries, `{"status":"success","data":[...]}`.
- **Query params are ignored.** `?chain=Ethereum`, `?project=uniswap-v3`,
  `?include=…&exclude=…` all return the identical 10.4 MB payload. There is
  **no server-side filtering** — filter client-side.
- The `pool` field is a **UUID, never a 0x address** (0 of 15,290 entries have
  an address-like id). The address of the on-chain pool is NOT in the entry —
  matching is by `(chain, token pair, fee tier)` instead (§3.5).
- Every relevant entry has `underlyingTokens` (the two token addresses).

Entry shape (uniswap-v3, Base, 0.3% WETH/USDC — trimmed):

```jsonc
{
  "chain": "Base",
  "project": "uniswap-v3",
  "symbol": "WETH-USDC",
  "tvlUsd": 88992532,
  "apyBase": 90.11676,          // fee APR as % (DefiLlama methodology)
  "apyReward": null,
  "apy": 90.11676,
  "pool": "b99bcdf5-1350-4269-981e-0e9b5cccb007",   // UUID — chart endpoint id
  "apyPct1D": 7.25169, "apyPct7D": 6.72197, "apyPct30D": 40.06052,
  "stablecoin": false, "ilRisk": "yes", "exposure": "multi",
  "predictions": { "predictedClass": "Down", "predictedProbability": 89, "binnedConfidence": 3 },
  "poolMeta": "0.3%",           // fee tier for uniswap-v3; "CL 0.01%" for shadow
  "mu": 64.30551, "sigma": 1.5802, "count": 851,
  "outlier": true,              // 499/1641 uniswap-v3 entries are APY outliers
  "underlyingTokens": ["0x4200000000000000000000000000000000000006", "0x833589fcd6edb6e08f4c7c32d4f71b54da02913"],
  "il7d": null, "apyBase7d": null, "apyMean30d": 69.78323,
  "volumeUsd1d": 87887325.21365,  // 24h volume — 11/1641 entries have null here
  "volumeUsd7d": null, "apyBaseInception": null
}
```

Coverage of DefiLlama's yields index for our protocols (verified):

| DefiLlama project | Entries | Ethereum | Arbitrum | Base | OP Mainnet | Sonic |
|---|---|---|---|---|---|---|
| `uniswap-v3` | 1,641 | 517 | 193 | 435 | 69 | 0 |
| `shadow-exchange-clmm` | 12 | — | — | — | — | 12 |

⚠️ The yields index is **partial** — many V3 pools are not tracked (Sonic has
no uniswap-v3 entries at all; Shadow is tracked). Hence the mandatory
fallback chain (§8).

⚠️ `outlier: true` marks DefiLlama's APY outliers (499/1,641). Those entries
are fine for `tvlUsd`, but we compute our own fee APR from
`volumeUsd1d × feeTier / tvlUsd` rather than trusting `apyBase`, and we skip
`apy*` fields entirely.

### 3.4 E3 — per-pool history (`yields.llama.fi/chart/{poolId}`)

```
GET https://yields.llama.fi/chart/b99bcdf5-1350-4269-981e-0e9b5cccb007
```

```jsonc
{ "status": "success", "data": [
    { "timestamp": "2023-12-03T23:05:17.943Z", "tvlUsd": 1002,
      "apy": 5.42842, "apyBase": 5.42842, "apyReward": null,
      "il7d": -0.3149, "apyBase7d": 0.04749, "pricePerShare": null },
    ...
  ] }
```

- `poolId` is the UUID from E2 — **requires the E2 index first**.
- Daily points (~950 for a mature pool). Use `tvlUsd` only (ignore `apy*`,
  our own math supersedes it; keep `il7d` as an optional sanity cross-check).
- Timestamps are ISO strings — parse to unix seconds in the provider.

### 3.5 E4/E5 — protocol context

- `api.llama.fi/protocol/uniswap-v3` → `currentChainTvls: {"Sonic": 25.4M, ...}`,
  `tvl: [{date, totalLiquidityUSD}, ...]` daily history. Protocol-level only
  (no `pool2` array for uniswap-v3 — verified).
- `api.llama.fi/summary/dexs/uniswap-v3` → `total24h: 900_373_638`,
  `chainBreakdown: {"Sonic": {"total24h": 22_853, ...}, ...}`,
  `totalDataChartBreakdown: [ [ts, {"Ethereum": {"Uniswap V3": 16_937_182}}], ... ]`.
- Use cases: "this protocol has $X on this chain" context line, and a
  protocol-level volume-to-TVL sanity check. **Lowest priority** (slice 6+).

### 3.6 Chain & project mappings (new `defi_llama_map.ts`)

Chain slugs (E1, lowercase) and chain names (E2/E3/E4, capitalized) differ:

| chainId | E1 coins slug | E2/E3 chain name |
|---|---|---|
| 1 | `ethereum` | `Ethereum` |
| 42161 | `arbitrum` | `Arbitrum` |
| 8453 | `base` | `Base` |
| 146 | `sonic` | `Sonic` |
| 10 *(future)* | `optimism` | `OP Mainnet` |

Adapter id → DefiLlama project:

| adapter id | DefiLlama `project` |
|---|---|
| `uniswap-v3` | `uniswap-v3` |
| `shadow-cl` | `shadow-exchange-clmm` |

### 3.7 Pool matching strategy (E2 → our pool address)

DefiLlama's yields index cannot be matched by pool address (`pool` is a UUID).
Match by the natural key we already have everywhere — **(chain, token pair,
fee tier)** — exactly the triple `lookupPool(tokenA, tokenB, fee)` uses:

```
key = lower(chainName) | sorted(lower(token0), lower(token1)) | feeHundredthsOfBps
```

- `poolMeta` parsing: `"0.05%" → 500`, `"0.3%" → 3000`, `"1%" → 10000`,
  `"0.01%" → 100`; for Shadow strip the `"CL "` prefix first
  (`"CL 0.24%" → 2400`). Parse the **number**, never string-compare
  (`"0.3%"` vs `"0.30%"`).
- Verified: the key is **unique** across all 1,641 `uniswap-v3` entries
  (0 ambiguous keys) — a `Map<string, entry>` index is safe.

---

## 4. Target architecture

### 4.1 Layering (respects AGENT.md §3 — verified against the current tree)

```
Nuxt UI            (PoolDetailsTab, DiscoverForm, ChartsTab, composables)
   ↓
Application        (GetPoolTvlUseCase, AnalyzePoolUseCase, CompareStrategiesUseCase, DTOs)
   ↓
Domains            (Pool.virtualReserves(), AnalyticsEngine poolTvl/feeApr/share)
   ↓
Math               (virtual_reserves.util, fee_apr.util)
   ↓
Shared             (TPoolLiquidity, TTokenPrice, TPoolTvlPoint)

Providers ────► app/core/providers/market/          ← NEW (HTTP-only, no viem)
                 ├─ market_data_provider.interface.ts      IMarketDataProvider
                 ├─ defi_llama_map.const.ts               chain/project maps
                 ├─ defi_llama_market_data_provider.class.ts
                 ├─ create_market_data_provider.factory.ts
                 └─ index.ts
```

Dependency-rule compliance:

- `providers/market` imports **only** `@core/shared/types` — no viem, no SDK,
  no other provider (§3 forbids cross-provider imports; this provider uses
  plain `fetch`).
- Domains stay IO-free: they receive `TPoolLiquidity` values, they never fetch.
- The application layer composes adapter (pool state) + market provider
  (TVL/prices) + math (virtual reserves) into DTOs.

### 4.2 New files

| File | Content |
|---|---|
| `app/core/shared/types/pool_liquidity.type.ts` | `TPoolLiquidity` (§5.1) |
| `app/core/shared/types/token_price.type.ts` | `TTokenPrice` (§5.1) |
| `app/core/shared/types/pool_tvl_point.type.ts` | `TPoolTvlPoint` (history point) |
| `app/core/shared/value_objects/pool_liquidity.value-object.ts` | `PoolLiquidityVO` — validated wrapper (tvl > 0, timestamp sane, source enum) |
| `app/core/math/virtual_reserves.util.ts` | `virtualReserves(liquidity, sqrtPriceX96)` (§5.2) |
| `app/core/math/fee_apr.util.ts` | `feeAprFromTurnover(...)`, `annualizeDailyRate(...)` (§5.3) |
| `app/core/providers/market/market_data_provider.interface.ts` | `IMarketDataProvider` |
| `app/core/providers/market/defi_llama_map.const.ts` | chainId → slugs, adapter → project |
| `app/core/providers/market/defi_llama_market_data_provider.class.ts` | E1/E2/E3 implementation + matching (§3.7) |
| `app/core/providers/market/create_market_data_provider.factory.ts` | `createMarketDataProvider(...)` |
| `app/core/providers/market/index.ts` | barrel |
| `app/core/application/dtos/pool_tvl.dto.ts` | `IPoolTvlDTO` |
| `app/core/application/use_cases/get_pool_tvl.use.case.ts` | `GetPoolTvlUseCase` |
| `app/composables/usePoolTvl.ts` | thin UI glue (per §9.5 composable template) |
| tests (§9) | co-located under `app/core/test/` |

### 4.3 Changed files

| File | Change |
|---|---|
| `app/core/math/index.ts` | re-export the two new utils + scales |
| `app/core/shared/types/index.ts` | re-export new types |
| `app/core/domains/pool/pool.class.ts` | `virtualReserves()` method |
| `app/core/domains/analytics/analytics_engine.class.ts` | `poolTvl()`, `poolFeeApr()`, `positionShareOfPool()` |
| `app/core/services/core_services.class.ts` | hold `IMarketDataProvider`, wire into `useCases()` |
| `app/core/application/use_cases/analyze_pool.use.case.ts` | optional `liquidity?: TPoolLiquidity` input → DTO fields |
| `app/core/application/dtos/pool_analysis.dto.ts` | `tvlUsd`, `volume24hUsd`, `feeApr`, `tvlSource`, `tvlTimestamp` |
| `app/core/application/use_cases/compare_strategies.use_case.ts` | accept `liquidity`, replace the 30% prior with `feeApr` (slice 4) |
| `app/core/domains/strategy/strategy.interface.ts` | optional `IStrategyContext` third arg (slice 4) |
| `app/core/domains/recommendation/*_strategy.class.ts` | prefer `context.expectedApr` when present (slice 4) |
| `app/plugins/core.client.ts` | construct the provider, inject into services |
| `app/components/PoolDetailsTab.vue` | "Liquidity & TVL" card |
| `app/components/ChartsTab.vue` + `app/utils/priceChart.ts` | optional TVL series (slice 5) |

---

## 5. Data model, units & math

### 5.1 Types (all new money fields are bigint; no floats cross the provider boundary)

```ts
// app/core/shared/types/token_price.type.ts
export interface TTokenPrice {
  readonly token: TAddress;
  /** USD price at 1e18 scale (1797.89 USD → 1797896200000000000000n). */
  readonly usdPrice: bigint;
  /** DefiLlama confidence ∈ [0,1] at 1e18 scale. */
  readonly confidence: bigint;
  /** Unix seconds of the price observation. */
  readonly timestamp: bigint;
}
```

```ts
// app/core/shared/types/pool_liquidity.type.ts
export interface TPoolLiquidity {
  readonly pool: TAddress;
  readonly chainId: number;
  readonly protocolId: string;

  /** Total value locked, USD, at USD_DECIMALS (6) scale. */
  readonly tvlUsd: bigint;

  /** Rolling 24h volume, USD, at USD_DECIMALS (6) scale. `0n` = unknown. */
  readonly volume24hUsd: bigint;

  /** DefiLlama pool id (UUID) when matched — needed for the history chart. */
  readonly externalPoolId?: string;

  /** 'defi-llama' | 'on-chain-estimates' — display + merge policy. */
  readonly source: string;

  /** Unix seconds of the snapshot. */
  readonly timestamp: bigint;
}
```

```ts
// app/core/shared/types/pool_tvl_point.type.ts
export interface TPoolTvlPoint {
  /** Unix seconds. */
  readonly timestamp: bigint;

  /** USD, at USD_DECIMALS (6) scale. */
  readonly tvlUsd: bigint;
}
```

**Unit conventions (add to `app/core/shared/utils/`):**

- `USD_DECIMALS = 6` — all USD amounts are bigint × 10^6 (USDC-like). Rationale:
  JSON gives floats; 6 decimals absorbs `Math.round(v * 1e6)` without precision
  loss for the magnitudes DefiLlama reports (verified: `88992532.21365` → safe).
- Token USD **prices** are 1e18 fixed-point (they multiply/divide raw amounts).
- All ratios (APR, share, probability) stay at the existing 1e18 scales
  (`APR_SCALE`, `SCORE_SCALE`).

### 5.2 Virtual reserves (on-chain TVL, no external API)

Standard CL approximation — values the liquidity **active at the current tick**
as if it were one full-range position (this is also how DefiLlama itself values
V3 pools, so the two sources are comparable):

```
amount0Raw = L × 2^96 / sqrtPriceX96
amount1Raw = L × sqrtPriceX96 / 2^96
```

```ts
// app/core/math/virtual_reserves.util.ts (signature)
export function virtualReserves(
  liquidity: bigint,
  sqrtPriceX96: bigint,
): { amount0Raw: bigint; amount1Raw: bigint };

/** USD value of the two raw legs at `token0Usd` / `token1Usd` (1e18 prices). */
export function virtualReservesInUsd(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number,
  token0Usd: bigint,
  token1Usd: bigint,
): bigint; // USD at USD_DECIMALS
```

Caveat (document in the util): excludes liquidity parked **outside** the
current tick → understates wide-range-heavy pools. Label it
`source: 'on-chain-estimates'` in the DTO so the UI can say "estimate".

### 5.3 Fee APR from turnover

```
poolFeeApr = (volume24h / tvl) × feeRate × 365      // feeRate = 0.0005 for 0.05%
```

```ts
// app/core/math/fee_apr.util.ts (signature)
export function feeAprFromTurnover(
  volume24hUsd: bigint,   // USD_DECIMALS scale
  tvlUsd: bigint,          // USD_DECIMALS scale
  feeRate: number,         // plain fraction (0.0005)
): bigint;                 // APR_SCALE (1e18 == 100%/yr)
```

Rules: `tvlUsd <= 0n` → throw (caller must fall back first); `volume24hUsd`
may be `0n`/unknown → returns `0n` (caller keeps the prior). Smooth with
7d/30d averages in a later slice; label 24h-derived APR as *"24h-based,
extrapolated"* in the UI.

### 5.4 Position-level expected APR (the payoff — slice 4)

```
expectedFeeAPR(range) = poolFeeAPR × capitalEfficiency(range) × P(in-range | horizon)
```

- `capitalEfficiency` — already exists (`math/capital_efficiency.util.ts`),
  the fee-density multiplier vs full range.
- `P(in-range)` — the `VolatilityAdjustedRangeGenerator` already builds ranges
  as `k · σ_daily · √horizonDays`, so **k is the z-score** and the two-sided
  coverage is `2Φ(k) − 1` (k=1 → 68%, k=1.65 → 90%, k=2 → 95%, k=2.5 → 99%).
  Recover `k` per candidate: `halfWidthTicks / (σ_daily · √horizonDays)`.
  Needs one new util: `app/core/math/normal_cdf.util.ts`
  (bigint fixed-point `Φ`, Abramowitz–Stegun `erf` approximation is precise
  enough at 1e18 for k ≤ 3).

```ts
// delivered to strategies via a new optional context (backward compatible)
export interface IStrategyContext {
  /** Range-specific expected fee APR at APR_SCALE (see §5.4). */
  readonly expectedApr: bigint;
  /** Pool-level fee APR (before range adjustments), APR_SCALE. */
  readonly poolFeeApr: bigint;
  /** Pool TVL, USD_DECIMALS scale. `0n` = unknown. */
  readonly tvlUsd: bigint;
  /** P(in range over horizon), SCORE_SCALE (1e18 == 1.0). */
  readonly inRangeProbability: bigint;
}

score(pool: Pool, position: Position, context?: IStrategyContext): bigint;
```

**Implementation notes (slice 4, as shipped — see `AGENT.md` §6.22).**

- **Normalised capital efficiency, not the raw ratio.** The formula above
  reads `capitalEfficiency(range)` as the raw fee-density multiplier
  (`capitalEfficiencyRatio`), but that ratio is **unbounded** — ≈ 40× at
  ±5 %. Multiplying it straight into an APR would push the "expected
  APR" far outside any plausible range and **saturate** the strategies'
  APR factor, which would make the in-range probability irrelevant
  again. The engine therefore multiplies the **normalised** factor
  `capitalEfficiencyFactor(ce, CE_FACTOR_CEILING)` — `ln(CE)/ln(ceiling)`,
  which lives in `[0, 1]` — so `expectedApr ≤ poolFeeApr` always and
  `P(in range)` stays meaningful in the mix.
- **CDF method.** `normal_cdf.util.ts` uses the **erf power series** for
  `z = x/√2 ≤ 4.5` and the **asymptotic `erfc` expansion** beyond it
  (truncated at its smallest term), at a 1e30 internal working scale.
  That is more accurate than the Abramowitz–Stegun approximation
  sketched above (≈ 1e-19 absolute vs ≈ 1e-9), and it keeps the "no
  magic constants" property — `√2` and `√π` are computed at load time
  with an integer square root rather than hard-coded.

### 5.5 Position share of pool (exit-impact guard)

```
share = notionalUsd / tvlUsd            // SCORE_SCALE (1e18 == 1.0)
```

Surface as a warning in `SimulationTab` when `share > 2%` (configurable) —
"your deposit is X% of this pool; entry/exit will move the price".

---

## 6. Implementation slices

Each slice is shippable and testable independently. Slices 0–3 are the
"vertical slice"; 4 is the payoff; 5–6 are polish. **Do them in order** —
later slices depend on the types/utilities of earlier ones.

---

### Slice 0 — Foundations: types, math, barrel re-exports

**Goal.** Everything that carries no I/O: shared types, the two math utils,
`USD_DECIMALS`, scales, barrel updates.

**Files.**
- `app/core/shared/types/{token_price,pool_liquidity,pool_tvl_point}.type.ts` (§5.1)
- `app/core/shared/utils/usd.util.ts` — `USD_DECIMALS`, `toUsdBigint(number)`,
  `formatUsd(bigint)`.
- `app/core/math/virtual_reserves.util.ts`, `app/core/math/fee_apr.util.ts`
- `app/core/shared/value_objects/pool_liquidity.value-object.ts`
  (validates: `tvlUsd >= 0n`, `volume24hUsd >= 0n`, known `source`,
  `timestamp > 0n`; exposes `isStale(maxAgeSeconds)`).
- Edit barrels: `shared/types/index.ts`, `shared/utils/index.ts`,
  `shared/value_objects/index.ts`, `math/index.ts`.

**Tests.**
- `app/core/test/math/virtual_reserves.test.ts` — invariants: known pair
  (`L=1e18, sqrtPriceX96=2^96` → `amount0 = amount1 = 1e18`); zero/invalid
  inputs throw; symmetry `amount0·price ≈ amount1`.
- `app/core/test/math/fee_apr.test.ts` — `volume=10M, tvl=100M, fee=0.05%` →
  APR ≈ 18.25%/yr (1e18 scale); `tvl=0` throws; `volume=0` → `0n`.
- `app/core/test/shared/pool_liquidity_vo.test.ts`.

**Acceptance.** `pnpm test` + `pnpm typecheck` green; no float in any new type.

---

### Slice 1 — On-chain TVL baseline (works with zero external calls)

**Goal.** `Pool.virtualReserves()` + a pure `AnalyticsEngine.poolTvlOnChain(...)`
that values the legs with caller-supplied token prices. This is the fallback
tier and the only tier available offline.

**Files.**
- `app/core/domains/pool/pool.class.ts` — add `virtualReserves()` (delegates
  to `math/virtual_reserves.util`), plus `tvlToken0()` convenience (both legs
  priced in token0 at 18d via `Price.ratio`).
- `app/core/domains/analytics/analytics_engine.class.ts` — add
  `poolTvlOnChain(pool, token0Usd, token1Usd)` (→ USD at 6d) and
  `positionShareOfPool(notionalUsd, tvlUsd)`.
- **Fix needed first:** `UniswapV3Adapter.getPoolStateAtBlock` currently
  zeroes `liquidity` (`liquidity: 0n`) — extend `readStateAtBlock` to also
  multicall `liquidity()` at the pinned block. Without it there is no
  on-chain TVL *history* (live TVL is unaffected).

**Tests.**
- `app/core/test/domains/pool/virtual_reserves.test.ts` — against a stub
  `TPoolState` (reuse `app/core/test/_fixtures/`).
- Extend `app/core/test/math/math-engine.test.ts` with a
  `virtualReservesInUsd` case cross-checked against a hand-computed value.

**Acceptance.** Given any live pool state, TVL-in-token-units is computable
without network; USD variant computable given two prices.

---

### Slice 2 — DefiLlama market-data provider

**Goal.** `IMarketDataProvider` + the DefiLlama implementation covering E1
(prices), E2 (per-pool index), E3 (per-pool history).

**Files.**
- `app/core/providers/market/market_data_provider.interface.ts`

```ts
export interface IMarketDataProvider {
  readonly id: string;
  readonly name: string;
  readonly version: string;

  /** USD prices for `tokens` on `chainId`. Missing prices are omitted. */
  getTokenPrices(
    chainId: number,
    tokens: readonly TAddress[],
  ): Promise<readonly TTokenPrice[]>;

  /** Per-pool liquidity snapshot, or `null` when unknown (→ caller falls back). */
  getPoolLiquidity(
    chainId: number,
    protocolId: string,
    pool: TAddress,
    token0: TAddress,
    token1: TAddress,
    fee: number,                       // hundredths of a basis point (500 = 0.05%)
  ): Promise<TPoolLiquidity | null>;

  /** Daily TVL history, or `null` when the pool isn't tracked. */
  getPoolTvlHistory(
    chainId: number,
    pool: TAddress,
  ): Promise<readonly TPoolTvlPoint[] | null>;
}
```

- `app/core/providers/market/defi_llama_map.const.ts` — chainId→slug/name map
  (§3.6) + adapter→project map. Unknown chain → `undefined` → provider
  returns `null`/`[]` (never throws).
- `app/core/providers/market/defi_llama_market_data_provider.class.ts`
  - `getTokenPrices` → E1, one batched call, float→bigint conversion here.
  - `getPoolLiquidity` → loads the E2 index (see caching, §7), builds the
    `Map` keyed per §3.7, looks up `(chainName, pair, fee)`, maps the entry
    (`tvlUsd` → 6d bigint, `volumeUsd1d ?? 0`, `pool` UUID
    → `externalPoolId`, `source: 'defi-llama'`).
  - `getPoolTvlHistory` → E3 with the UUID discovered during
    `getPoolLiquidity` (cache the address→UUID mapping; §7).
  - Matching: parse `poolMeta` to hundredths-of-bps (§3.7); skip entries with
    `outlier === true` **only for APY fields**, keep `tvlUsd`.
- `app/core/providers/market/create_market_data_provider.factory.ts`

```ts
export function createMarketDataProvider(
  opts?: { readonly fetchImpl?: typeof fetch; readonly now?: () => bigint },
): IMarketDataProvider;   // default: DefiLlamaMarketDataProvider
```

`fetchImpl` injection keeps it unit-testable (per AGENT.md §9.1 style).

**Tests.** `app/core/test/providers/market/defi_llama_market_data_provider.test.ts`
— stub `fetchImpl` returning the verified sample payloads (§3.2, §3.3, §3.4):
- parses E1 float prices into 1e18 bigints;
- matches the WETH/USDC 0.3% Base entry via `(chain, pair, fee)` key;
- parses Shadow `"CL 0.24%"` → `2400`;
- returns `null` for an unknown pair / unknown chainId;
- never throws on network error (returns `null` / `[]` — §8).

**Acceptance.** From a browser console: prices for any token on our 4 chains;
pool TVL for any pool that exists in the yields index.

---

### Slice 3 — Application layer + UI: `GetPoolTvlUseCase`, DTO, the TVL card

**Goal.** Wire provider + math into a UI-ready DTO with the full fallback
chain; render it.

**Fallback chain (§8 formalized):**

```
1. provider.getPoolLiquidity(...)                    → source 'defi-llama'
2. else virtual reserves + provider token prices     → source 'on-chain-estimates'
3. else virtual reserves + stablecoin anchor ($1)    → source 'on-chain-estimates' (labeled)
4. else virtual reserves in token units only          → tvlUsd = 0n, token legs still shown
```

**Files.**
- `app/core/application/dtos/pool_tvl.dto.ts`

```ts
export interface IPoolTvlDTO {
  readonly pool: TAddress;
  readonly chainId: number;
  readonly protocolId: string;

  /** USD at USD_DECIMALS (6). `0n` = unknown. */
  readonly tvlUsd: bigint;
  readonly volume24hUsd: bigint;

  /** Pool-level fee APR at APR_SCALE, or `0n` when volume/TVL unknown. */
  readonly feeApr: bigint;

  /** Virtual-reserve legs (raw, always present from pool state). */
  readonly amount0Raw: bigint;
  readonly amount1Raw: bigint;

  /** Deposit as a share of the pool at SCORE_SCALE (input `notionalUsd`). */
  readonly positionShare: bigint;

  readonly source: 'defi-llama' | 'on-chain-estimates' | 'token-units';
  readonly externalPoolId?: string;
  readonly timestamp: bigint;
}
```

- `app/core/application/use_cases/get_pool_tvl.use.case.ts` —
  constructor `(resolveAdapter: TAdapterResolver, market: IMarketDataProvider,
  analytics: AnalyticsEngine)`; `execute({pool, chainId, protocolId,
  notionalUsd?})` → validates per §9.4 template (throw
  `InvalidUseCaseInputError` for a missing pool), implements the chain above.
- `app/core/services/core_services.class.ts` — hold
  `market: IMarketDataProvider`, add `getPoolTvl` to `ICoreUseCases`
  (constructor option `market?` defaults to
  `createMarketDataProvider()`), keep `useCases()` the single factory.
- `app/core/application/use_cases/analyze_pool.use.case.ts` — optional
  `liquidity?: TPoolLiquidity` input; when present, echo
  `tvlUsd/volume24hUsd/feeApr/source` onto `IPoolAnalysisDTO` (new fields,
  documented in the DTO header).
- `app/plugins/core.client.ts` — construct `createCoreServices({ network,
  adapters, market: createMarketDataProvider() })`.
- `app/composables/usePoolTvl.ts` — thin glue (loading/error/refresh), per
  the §9.5 template. **No business logic** (AGENT.md §10).
- `app/components/PoolDetailsTab.vue` — new card:

```
┌ Liquidity & TVL ────────────────────────────────┐
│ TVL                    $88,992,532   (defi-llama) │
│ 24h volume             $87,887,325                │
│ implied fee APR        90.1%   (24h-based)        │
│ virtual reserves       24.1k WETH / 43.3M USDC   │
│ your deposit share     0.01%                     │
└──────────────────────────────────────────────────┘
```

`formatUsd` (slice 0) renders the 6d bigints; `source` drives a muted
"estimate" badge.

**Tests.**
- `app/core/test/application/use_cases/get_pool_tvl.test.ts` — stub adapter
  (existing `_fixtures/stub_protocol_adapter.ts`) + stub market provider:
  - returns E2 numbers when the provider matches;
  - falls back to virtual reserves when the provider returns `null`;
  - falls back further when prices are missing (token-units tier);
  - `feeApr` math consistent with slice-0 util for given volume/TVL/fee;
  - `positionShare` correct for `notionalUsd = 10% of tvlUsd`.

**Acceptance.** Pool page shows a populated TVL card on all 4 supported
chains (on chains/pools DefiLlama doesn't track, the card shows the
on-chain estimate tier with the badge).

---

### Slice 4 — Pool-aware recommendations (the payoff)

**Goal.** Replace the hardcoded 30% prior with the pool's own fee APR and
make APR range-specific.

**Files & steps.**
1. `app/core/math/normal_cdf.util.ts` — bigint fixed-point `Φ(x)` at 1e18
   (rational approximation; adequate for `k ∈ [0, 3.5]`).
2. `app/core/domains/strategy/strategy.interface.ts` — add optional
   `IStrategyContext` third parameter (§5.4). **Backward compatible**:
   existing strategies ignore it.
3. `app/core/domains/recommendation/recommendation_engine.class.ts` —
   accept `liquidity?: TPoolLiquidity` in `IRecommendInput`; when present,
   compute per candidate: `poolFeeApr` (util), `CE` (already computed),
   `k` from `halfWidth / (σ_daily·√horizon)` (engine needs `σ_dailyTicks`
   + `horizonDays` — already in the use case), `P(in range) = 2Φ(k)−1`,
   `expectedApr = poolFeeApr × CE × P`; pass as `IStrategyContext`.
4. Strategies (`balanced`, `maximum_fee`, `highest_sharpe`) —
   `const apr = context?.expectedApr ?? this.expectedApr;`
5. `app/core/application/use_cases/compare_strategies.use_case.ts` —
   accept `liquidity?: TPoolLiquidity`; build `expectedApr` as
   `feeAprFromTurnover(...) ?? prior 30%`; pass into engine + strategies.
6. `app/pages/pool/[pool].vue` — after `analyzePool`, call `getPoolTvl` and
   feed `liquidity` into `compareStrategies` (single extra await, no new
   UX).

**Tests.**
- `app/core/test/math/normal_cdf.test.ts` — `Φ(1) ≈ 0.8413`, `Φ(0) = 0.5`,
  monotonicity, precision ≥ 1e15 at 1e18.
- Extend `app/core/test/recommendation/recommendation.test.ts`:
  - with `liquidity`, `MaximumFee` prefers a narrower-but-covered range over
    a razor-thin range that is usually out of range (behavior change vs.
    today: thin ranges no longer dominate when P(in-range) is low);
  - without `liquidity`, output is byte-identical to today's (regression
    guard for the 30% prior path).

**Acceptance.** Two pools with identical geometry but 10× different
volume/TVL now produce **different rankings and APRs**. This is the slice
that makes the engine real.

---

### Slice 5 — TVL history chart

**Goal.** TVL trend next to the price chart; "liquidity flight" signal.

**Files.**
- `app/core/application/use_cases/get_pool_tvl_history.use.case.ts` — wraps
  `IMarketDataProvider.getPoolTvlHistory` + `externalPoolId` discovery;
  returns `IPoolTvlHistoryDTO { points: TPoolTvlPoint[] }` or empty when the
  pool isn't tracked (never throws; UI hides the series).
- `app/utils/priceChart.ts` — optional second series (line, separate scale)
  or second pane via the v5 `panes` API; TVL points are `UTCTimestamp`-keyed
  exactly like the price candles.
- `app/components/ChartsTab.vue` — legend entry "TVL (DefiLlama)".

**Tests.** Extend `app/core/test/utils/priceChart.test.ts` — TVL series is
only added when points exist; scale/pane options are asserted against the
injected mock (the file already asserts the v5 API surface).

**Acceptance.** Charts tab shows the price chart + a TVL line for any pool
tracked by DefiLlama (uniswap-v3 on Ethereum/Base/Arbitrum, Shadow on
Sonic).

**Implementation notes (as shipped).**

- **Pane, not overlay.** The TVL trend is a `LineSeries` in **pane 1**
  (`chart.addSeries(lw.LineSeries, opts, 1)`) with its own right-hand
  scale; the price pane keeps a 3:1 stretch factor against the TVL
  strip. A second *scale* on the price pane was rejected: the price
  labels and the TVL labels would share one gutter and overlap.
- **External-id discovery.** `IMarketDataProvider.getPoolTvlHistory`
  needs the provider's own pool id (a DefiLlama UUID), which the
  provider only learns while matching the natural key. The use case
  therefore calls `getPoolLiquidity` **first** (pool state → token
  addresses + fee tier) and then the history read. This is also what
  primes the provider's `externalPoolIds` cache.
- **Alignment.** The TVL points are clipped to the price candles' own
  time span (`candleTimeRange` + `clipTvlPointsToRange`), so a
  multi-year TVL history can't stretch the price chart's x-axis.
- **Degradation.** Empty points ⇒ no series, no second pane, no
  legend entry: the chart looks exactly as it did before the feature.
  The charts tab never fails because of the TVL panel.

---

### Slice 6 — Backlog / optional (not in the first pass)

| Item | Where | Notes |
|---|---|---|
| `minTvlUsd` floor + thin-pool warning | `ScoringConfig`, engine | Candidates on pools under the floor get flagged, not deleted |
| Discovery ranking by TVL / volume-to-TVL | `DiscoverPoolsUseCase` + `DiscoverForm.vue` | Needs a real pool list first (adapter currently returns `[]`) |
| Protocol/chain context (E4/E5) | pool page header | "Uniswap V3 on Base: $X TVL, $Y 24h volume" |
| 7d/30d smoothed fee APR | `fee_apr.util.ts` | E3 chart gives per-day `tvlUsd`; combine with volume history |
| Deposit slippage estimate from depth | `DepositSimulation` | price-impact ∝ notional / TVL |
| GeckoTerminal / Coingecko alternative provider | `providers/market/` | Same interface; pick via factory |

---

## 7. Caching & performance strategy

The one real cost in this roadmap is **E2 (10.4 MB)**. Policy:

| Call | Frequency | Cache |
|---|---|---|
| E1 prices (per pool visit) | on demand | memory, TTL 60 s (prices move) |
| E2 pools index | **once per session**, lazily on first pool page | **IndexedDB** (10 MB > localStorage quota), TTL **1 h**; store the parsed `Map` blob |
| E3 chart (per pool) | on charts-tab open | memory, TTL 10 min |
| E4/E5 (slice 6) | on demand | memory, TTL 1 h |

Rules:
- The index fetch is **lazy** — never on app boot; only when a pool page
  (or getPoolTvl) needs it.
- All DefiLlama calls are sequential-per-endpoint with a single
  in-flight promise (`getPoolLiquidity` from two tabs must not double-fetch).
- Show fetch state in the UI ("fetching pool index…", one-time ~1–5 s on a
  fresh session; cached afterwards).
- DefiLlama documents a soft rate limit (~30 req/min per IP for
  `api.llama.fi`; `coins.llama.fi` is more generous). We make ≤ 3 distinct
  endpoint hits per session — well under it. ⚠️ Re-verify the current
  numbers on the docs page when implementing slice 2.

---

## 8. Error handling & degradation policy

**Providers never throw for "data unavailable"; they return `null` / `[]`.**
Thrown errors are reserved for programming errors (invalid constructor
inputs). Network failures inside the DefiLlama provider:

```
fetch fails / non-200 / JSON parse fails
  → getTokenPrices: drop the failed token (return the rest)
  → getPoolLiquidity: return null      → use case falls back to tier 2/3/4
  → getPoolTvlHistory: return null    → UI hides the TVL series
```

The UI must always render something for TVL: at minimum the virtual-reserve
legs in token units (tier 4), which require nothing but the pool state we
already fetch. The `source` field on the DTO is the single source of truth
for "how good is this number" — render it as a suffix/badge
(`defi-llama` / `estimate`).

Sanity clamps (in the use case, not the provider):
- `tvlUsd` from DefiLlama < virtual-reserve estimate ÷ 50 → prefer the
  on-chain number (stale index suspicion).
- `feeApr` > 10,000%/yr → clamp to `0n` and label unreliable
  (wash-trading / outlier pools).

---

## 9. Test plan (per AGENT.md §11)

| Slice | Test file (all under `app/core/test/`) | Live network? |
|---|---|---|
| 0 | `math/virtual_reserves.test.ts`, `math/fee_apr.test.ts`, `shared/pool_liquidity_vo.test.ts` | no |
| 1 | `domains/pool/virtual_reserves.test.ts`, extend `math/math-engine.test.ts` | no |
| 2 | `providers/market/defi_llama_market_data_provider.test.ts` (stubbed `fetchImpl`) | no |
| 3 | `application/use_cases/get_pool_tvl.test.ts` (stub adapter + stub provider) | no |
| 4 | `math/normal_cdf.test.ts`, extend `recommendation/recommendation.test.ts` | no |
| 5 | extend `utils/priceChart.test.ts` | no |
| optional | `providers/market/defi_llama_live.test.ts` — `it.skip(...)` live E1/E2 smoke, same pattern as the live-RPC tests (§11.5) | opt-in |

Conventions: Vitest `describe/it/expect` imported explicitly, no globals;
fixtures in `_fixtures/` (add `stub_market_data_provider.ts` mirroring
`stub_rpc_provider.ts`); every provider test asserts **degradation, not just
happy paths**; live tests must degrade to fixtures on transport failure so
the suite stays green offline.

---

## 10. Risks & open questions

| # | Risk | Mitigation |
|---|---|---|
| 1 | **10.4 MB index in the browser** | Lazy + IndexedDB + 1 h TTL (§7); worst case one 5 s wait per session, clearly indicated |
| 2 | **DefiLlama index coverage is partial** (no uniswap-v3 on Sonic; ~1.6k of ~10k+ V3 pools) | Fallback chain tiers 2–4 (§8); `source` label always shown |
| 3 | **Yields `pool` ids are UUIDs** — no address matching | Natural-key match `(chain, pair, feeTier)`; verified unique (§3.7) |
| 4 | **`api.llama.fi/overview/*` endpoints are currently 500** | Roadmap uses `/summary/dexs/*` and `/protocol/*` only (E7/E8 marked ❌) |
| 5 | **24h annualization is noisy** | Label "24h-based"; smooth later (slice 6); sanity-clamp absurd APRs |
| 6 | **Float → bigint precision** | Convert at the provider boundary, 6d USD / 18d prices, unit tests with the real sample values (§3.2/§3.3) |
| 7 | **Virtual reserves exclude out-of-range liquidity** | Documented approximation; `source: 'on-chain-estimates'` label; never mix tiers in one formula |
| 8 | **Rate limits change** | ≤ 3 endpoint hits per session; re-verify limits at slice 2; all calls wrapped for graceful failure |
| 9 | **CORS policy changes** (open `*` today, verified) | Provider is interface-only — if a proxy becomes necessary, swap the impl or add a Nitro proxy without touching the use cases |
| 10 | `getPoolStateAtBlock` zeroes `liquidity` | Slice 1 fixes it; required for any on-chain TVL *history* (not for live TVL) |
| 11 | README Phase 10 says "Chart.js" but the repo uses **lightweight-charts v5** | Fix the stale line when touching the charts tab (slice 5) |

Open questions (decide before/while implementing):
- Should `IPoolAnalysisDTO` grow TVL fields (slice 3 plan) or stay lean with
  a separate `getPoolTvl` call only? (Roadmap assumes: both — echo fields
  for convenience, use case for the detail card.)
- Cache TTL for the E2 index: 1 h (roadmap) vs 24 h (more stale, fewer
  refetches)? Start with 1 h, measure.
- Do we want DefiLlama's `apyBase` as a cross-check (display "DefiLlama
  says X%, we compute Y%")? Deferred to slice 6.

---

## 11. Definition of Done (per AGENT.md §10 — TVL-specific subset)

- [ ] New dependency installed only via **pnpm** (expected: **none** — plain
      `fetch` + built-in `BigInt`; IndexedDB via a hand-rolled ~40-line
      wrapper or `idb-keyval`, decided in slice 2).
- [ ] `pnpm test` and `pnpm typecheck` green after **every slice**.
- [ ] Every new `app/core/**` file: snake_case + correct postfix
      (`.type.ts`, `.class.ts`, `.factory.ts`, `.util.ts`, `.const.ts`),
      leading path comment, barrel `index.ts` per folder.
- [ ] No `any`, no `// @ts-ignore`, no float money values in Core.
- [ ] Dependency rules hold: `providers/market` imports only
      `@core/shared/**`; domains/math unchanged in their import surface.
- [ ] Every slice's test file added under `app/core/test/` (never repo root),
      no browser/Playwright per §11.1.
- [ ] Diff (`git status` + `git diff --stat`) shown to the user and explicit
      approval received **before any commit** (§11.6).
- [ ] No dev server, no `pnpm run build` (§8.0/§8.1).

---

## 12. Documentation updates (part of the slice that lands them)

| Slice | Update |
|---|---|
| 2 | AGENT.md §6.2-adjacent: new `providers/market/` module reference + §5.6 mention of the third provider |
| 3 | AGENT.md §6.x: `GetPoolTvlUseCase` + `IPoolTvlDTO` + composable entry |
| 4 | AGENT.md §6.13: strategy-context change; README "Recommendation Flow" gains a TVL step |
| 5 | Fix README Phase 10 "Chart.js" → lightweight-charts; charts section gains TVL series |
| 6 | README Phase 9 checklist items ("Alternative price/history sources", "pool comparison") ticked |
| all | Keep this file's §13 status board updated |

---

## 13. Status board

| Slice | Title | Depends on | Status |
|---|---|---|---|
| 0 | Types, scales, `virtual_reserves` + `fee_apr` math | — | ☑ done — `usd.util.ts` (incl. `toUsdPriceBigint`), `scale.util.ts`, `virtual_reserves.util.ts`, `fee_apr.util.ts` (`feeAprFromTurnover`, `annualizeDailyRate`), `stablecoin.util.ts`, the shared market-data types (`TTokenPrice`, `TPoolLiquidity`, `TPoolTvlPoint`) and `PoolLiquidityVO` (see `AGENT.md` §6.19–§6.21) |
| 1 | On-chain TVL baseline (`Pool.virtualReserves`, analytics, `liquidity@block` fix) | 0 | ☑ done — `Pool.virtualReserves()`/`tvlToken0()`, `AnalyticsEngine.poolTvlOnChain()`/`positionShareOfPool()`, `liquidity()` now read at the pinned block in the Uniswap V3 and Shadow adapters; 19 tests network-free (see `AGENT.md` §6.19) |
| 2 | DefiLlama `IMarketDataProvider` (E1/E2/E3) + caching | 0 | ☑ done — `IMarketDataProvider` + `DefiLlamaMarketDataProvider` (E1 prices, E2 index match, E3 history) with exact float→bigint conversion, memory caches (60 s / 1 h / 10 min) and single-flight requests; 28 tests network-free (see `AGENT.md` §6.20). ⚠ E2 index cache is **memory-only** — IndexedDB persistence is deferred (getPoolIndex() is the seam) |
| 3 | `GetPoolTvlUseCase` + DTO + fallback chain + TVL card | 1, 2 | ☑ done — `GetPoolTvlUseCase` + `IPoolTvlDTO`, the full fallback chain (indexed TVL → two-price on-chain estimate → one-price / stablecoin-anchor estimate → token units) with the stale-index (÷ 50) and 10,000 %/yr APR clamps, `implied_fee_apr.util.ts` as the single clamp home, optional liquidity enrichment in `AnalyzePoolUseCase`, one shared market provider wired through `CoreServices` / `createCoreServices` / `core.client.ts`, the `usePoolTvl` composable and the *Liquidity & TVL* card in `PoolDetailsTab.vue`; 20 network-free use-case tests (see `AGENT.md` §6.21) |
| 4 | Fee APR into the recommendation engine (`IStrategyContext`, `normal_cdf`) | 3 | ☑ done — `normal_cdf.util.ts` (bigint fixed-point `Φ` at 1e18, erf series + asymptotic `erfc` tail), optional `IStrategyContext` as the third `score()` parameter, per-candidate `expectedApr = poolFeeApr × capitalEfficiencyFactor × P(in range)` in `RecommendationEngine`, the three APR-driven strategies reading `context?.expectedApr ?? prior`, `CompareStrategiesUseCase` accepting an optional liquidity snapshot and deriving `poolFeeApr` via `impliedFeeApr()`, `toPoolLiquidity()` on the pool page wiring, and the **30 % prior preserved byte-identically** whenever the snapshot is missing or the implied APR is not credible; 15 CDF + 6 recommendation tests network-free (see `AGENT.md` §6.22) |
| 5 | TVL history chart | 2, 3 | ☑ done — `GetPoolTvlHistoryUseCase` + `IPoolTvlHistoryDTO` (pool state → natural-key match → `externalPoolId` discovery → `getPoolTvlHistory`, degrading to empty points), an optional **second pane** in `app/utils/priceChart.ts` (`LineSeries` in pane 1, 3:1 pane stretch), `PriceChart.client.vue` TVL prop + sync lifecycle, the *TVL (DefiLlama)* legend entry in `ChartsTab.vue`, and the chart module's v5 typing fixes (`SeriesDefinition<'Line'>`, `ticksVisible`); 11 use-case + 14 chart tests network-free (see `AGENT.md` §6.23) |
| 6 | Floors, discovery ranking, protocol context, smoothing | 4 | ☐ backlog |

// app/core/math/fee_apr.util.ts

/**
 * Fee APR from pool turnover (TVL-ROADMAP.md §5.3).
 *
 *     poolFeeApr = (volume24h / tvl) × feeRate × 365
 *
 * This is the pool-level "if you provided the whole TVL as full-range
 * liquidity you would earn X% APR" estimate. Range-specific expected
 * APR (capital efficiency × P(in-range), §5.4) is layered on top of
 * it in the recommendation engine — not here.
 *
 * Conventions:
 *   - `volume24hUsd` and `tvlUsd` share `USD_SCALE`, so their ratio is
 *     scale-free (the 6-decimal scale cancels in the division).
 *   - `feeRate` is the *only* float input accepted here: a plain
 *     fraction, e.g. `0.0005` for a 0.05% tier (pass `pool.fee / 1e6`,
 *     since `pool.fee` is hundredths of a basis point). It is converted
 *     to 1e18 fixed-point immediately.
 *   - Output is at `APR_SCALE` (1e18 == 100%/yr).
 */

import { APR_SCALE } from './apr.util';

/** Days per year used to annualize daily rates (no leap days). */
export const DAYS_PER_YEAR = 365n;

/**
 * Annualize a daily rate (at `APR_SCALE`) by multiplying with the days
 * per year. Trivial, but keeps the "where did 365 come from" answer in
 * exactly one place.
 *
 * @param dailyRate - Rate per day at `APR_SCALE` (1e18 == 100%/day).
 * @param daysPerYear - Override the annualization window (default 365).
 * @throws When `dailyRate` is negative or `daysPerYear <= 0n`.
 */
export function annualizeDailyRate(
  dailyRate: bigint,
  daysPerYear: bigint = DAYS_PER_YEAR,
): bigint {
  if (dailyRate < 0n) {
    throw new Error(
      `annualizeDailyRate: dailyRate must be non-negative, got ${dailyRate}`,
    );
  }

  if (daysPerYear <= 0n) {
    throw new Error(
      `annualizeDailyRate: daysPerYear must be positive, got ${daysPerYear}`,
    );
  }

  return dailyRate * daysPerYear;
}

/**
 * Pool fee APR implied by a 24h turnover observation.
 *
 *     APR = (volume24hUsd / tvlUsd) × feeRate × 365
 *
 * Degradation rules (TVL-ROADMAP.md §5.3):
 *   - `tvlUsd <= 0n` → **throws**. There is no meaningful ratio; the
 *     caller must fall back to a prior APR *before* calling this.
 *   - `volume24hUsd === 0n` (unknown volume) → returns `0n`; the caller
 *     keeps its prior APR.
 *   - 24h-derived APRs are noisy by nature — callers must label them
 *     "24h-based, extrapolated" in the UI (and clamp absurd results
 *     per §8).
 *
 * @param volume24hUsd - Rolling 24h volume, USD at `USD_SCALE`.
 * @param tvlUsd - Pool TVL, USD at `USD_SCALE`.
 * @param feeRate - Fee tier as a plain fraction (`0.0005` for 0.05%).
 * @returns APR at `APR_SCALE` (1e18 == 100%/yr).
 * @throws When `tvlUsd <= 0n`, `volume24hUsd < 0n`, or `feeRate` is
 *   not a finite fraction in (0, 1).
 */
export function feeAprFromTurnover(
  volume24hUsd: bigint,
  tvlUsd: bigint,
  feeRate: number,
): bigint {
  if (tvlUsd <= 0n) {
    throw new Error(
      `feeAprFromTurnover: tvlUsd must be positive (caller must fall back to a prior APR first), got ${tvlUsd}`,
    );
  }

  if (volume24hUsd < 0n) {
    throw new Error(
      `feeAprFromTurnover: volume24hUsd must be non-negative, got ${volume24hUsd}`,
    );
  }

  if (!Number.isFinite(feeRate) || feeRate <= 0 || feeRate >= 1) {
    throw new Error(
      `feeAprFromTurnover: feeRate must be a finite fraction in (0, 1), got ${feeRate}`,
    );
  }

  // Unknown volume → no signal; the caller keeps its prior APR.
  if (volume24hUsd === 0n) {
    return 0n;
  }

  // Daily turnover ratio at APR_SCALE (the USD scales cancel).
  const dailyTurnover = (volume24hUsd * APR_SCALE) / tvlUsd;

  // feeRate → 1e18 fixed-point (the only float allowed at this boundary).
  const feeRateScaled = BigInt(Math.round(feeRate * Number(APR_SCALE)));

  // Daily fee yield at APR_SCALE.
  const dailyFeeRate = (dailyTurnover * feeRateScaled) / APR_SCALE;

  return annualizeDailyRate(dailyFeeRate);
}

// app/core/math/virtual_reserves.util.ts

/**
 * Virtual reserves of concentrated liquidity (TVL-ROADMAP.md §5.2).
 *
 * Standard CL approximation: the liquidity active at the current tick,
 * valued *as if* it were one full-range position at the current price:
 *
 *     amount0Raw = L × 2^96 / sqrtPriceX96
 *     amount1Raw = L × sqrtPriceX96 / 2^96
 *
 * Invariant: amount0Raw × amount1Raw = L² (x·y = k for the virtual
 * reserves) — asserted by tests.
 *
 * Caveat (TVL-ROADMAP.md §10 risk 7): liquidity parked *outside* the
 * current price range is excluded, so pools with wide-range-heavy
 * positions are understated. Values derived from this helper must be
 * labeled `source: 'on-chain-estimates'` by consumers. This is also
 * how DefiLlama itself values V3 pools, so the two TVL tiers are
 * comparable in magnitude.
 */

import { TOKEN_PRICE_DECIMALS } from '../shared/types';
import { USD_DECIMALS } from '../shared/utils';

/** 2^96 — V3's fixed-point radix for `sqrtPriceX96`. */
const Q96 = 2n ** 96n;

/** Raw virtual-reserve pair (smallest token units). */
export interface IVirtualReserves {
  readonly amount0Raw: bigint;
  readonly amount1Raw: bigint;
}

/**
 * Compute the virtual reserves for `liquidity` at `sqrtPriceX96`.
 *
 * @param liquidity - Aggregate in-range liquidity from the pool state
 *   (`pool.liquidity`), raw V3 units.
 * @param sqrtPriceX96 - Current square-root price from `slot0`.
 * @returns Raw token0 / token1 amounts of the virtual full-range
 *   position implied by the current tick.
 * @throws When `liquidity <= 0n` (no in-range capital to value — the
 *   caller must treat it as "no on-chain estimate" and fall back) or
 *   when `sqrtPriceX96 <= 0n`.
 */
export function virtualReserves(
  liquidity: bigint,
  sqrtPriceX96: bigint,
): IVirtualReserves {
  if (liquidity <= 0n) {
    throw new Error(
      `virtualReserves: liquidity must be positive, got ${liquidity}`,
    );
  }

  if (sqrtPriceX96 <= 0n) {
    throw new Error(
      `virtualReserves: sqrtPriceX96 must be positive, got ${sqrtPriceX96}`,
    );
  }

  const amount0Raw = (liquidity * Q96) / sqrtPriceX96;
  const amount1Raw = (liquidity * sqrtPriceX96) / Q96;

  return { amount0Raw, amount1Raw };
}

/**
 * USD value of the virtual reserves, given per-token USD prices at
 * 1e18 fixed-point (`TTokenPrice` scale).
 *
 * Math per leg (`d` = token decimals, `p` = 1e18-scaled USD price):
 *
 *     valueUsd = (raw / 10^d) × (p / 10^18)
 *     scaled   = raw × p / 10^(d + 18 - 6) = raw × p / 10^(d + 12)
 *
 * Both legs are summed; the result is in `USD_SCALE` units (micro-USD,
 * `USD_DECIMALS = 6`).
 *
 * Unknown prices must be handled by the *caller* (fall back to the
 * stablecoin anchor or token-units tier per TVL-ROADMAP.md §8) —
 * passing 0 would silently understate the TVL, so this helper throws
 * on non-positive prices instead.
 *
 * @throws On `liquidity`/`sqrtPriceX96` violations (see
 *   {@link virtualReserves}), non-integer/negative decimals, or
 *   non-positive token prices.
 */
export function virtualReservesInUsd(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number,
  token0Usd: bigint,
  token1Usd: bigint,
): bigint {
  if (!Number.isInteger(token0Decimals) || token0Decimals < 0) {
    throw new Error(
      `virtualReservesInUsd: token0Decimals must be a non-negative integer, got ${token0Decimals}`,
    );
  }

  if (!Number.isInteger(token1Decimals) || token1Decimals < 0) {
    throw new Error(
      `virtualReservesInUsd: token1Decimals must be a non-negative integer, got ${token1Decimals}`,
    );
  }

  if (token0Usd <= 0n) {
    throw new Error(
      `virtualReservesInUsd: token0Usd must be positive, got ${token0Usd}`,
    );
  }

  if (token1Usd <= 0n) {
    throw new Error(
      `virtualReservesInUsd: token1Usd must be positive, got ${token1Usd}`,
    );
  }

  const { amount0Raw, amount1Raw } = virtualReserves(liquidity, sqrtPriceX96);

  const leg0Usd = legInUsd(amount0Raw, token0Usd, token0Decimals);
  const leg1Usd = legInUsd(amount1Raw, token1Usd, token1Decimals);

  return leg0Usd + leg1Usd;
}

/**
 * Value one raw leg at its 1e18-scaled USD price, in `USD_SCALE`
 * units. Private scale bookkeeping:
 *
 *     exponent = d + TOKEN_PRICE_DECIMALS(18) − USD_DECIMALS(6)
 */
function legInUsd(amountRaw: bigint, usdPrice: bigint, decimals: number): bigint {
  const exponent = BigInt(decimals + TOKEN_PRICE_DECIMALS - USD_DECIMALS);

  return exponent >= 0n
    ? (amountRaw * usdPrice) / 10n ** exponent
    : (amountRaw * usdPrice) * 10n ** (-exponent);
}

// app/core/shared/types/pool_liquidity.type.ts

import type { TAddress } from './address.type';

/**
 * Market-level liquidity snapshot for one pool (TVL-ROADMAP.md §5.1).
 *
 * This is data DefiLlama (or a future alternative provider) reports
 * about a pool — *not* anything read on-chain. USD amounts are bigints
 * at `USD_DECIMALS = 6` so no float ever crosses a provider boundary
 * (providers convert at the edge via `toUsdBigint`).
 */

/**
 * Known sources of pool liquidity snapshots, best → weakest
 * (TVL-ROADMAP.md §8 fallback tiers). The DTO/UI renders `source` as
 * the single source-of-truth label for "how good is this number".
 */
export const POOL_LIQUIDITY_SOURCES = [
  /** DefiLlama yields index (E2), matched by (chain, token pair, fee tier). */
  'defi-llama',
  /** Virtual reserves from the pool's live state, valued at token USD prices. */
  'on-chain-estimates',
  /** Virtual reserves in token units only — no USD valuation possible. */
  'token-units',
] as const;

export type TPoolLiquiditySource = (typeof POOL_LIQUIDITY_SOURCES)[number];

export interface TPoolLiquidity {
  /** Pool contract address. */
  readonly pool: TAddress;

  /** EVM chain id the pool lives on. */
  readonly chainId: number;

  /** Adapter/protocol id, e.g. `'uniswap-v3'` or `'shadow'`. */
  readonly protocolId: string;

  /** Total value locked, USD, at `USD_DECIMALS` (6). */
  readonly tvlUsd: bigint;

  /** Rolling 24h volume, USD, at `USD_DECIMALS` (6). `0n` = unknown. */
  readonly volume24hUsd: bigint;

  /**
   * External pool id (DefiLlama yields UUID) when the pool was matched
   * in the index — needed to fetch per-pool TVL history (E3).
   */
  readonly externalPoolId?: string;

  /** Where the numbers came from — display + merge policy (§8). */
  readonly source: TPoolLiquiditySource;

  /** Unix seconds of the snapshot. */
  readonly timestamp: bigint;
}

// app/core/shared/types/pool_tvl_point.type.ts

/**
 * One point of a pool's TVL history (TVL-ROADMAP.md §3.4/§5.1 — daily
 * snapshots from DefiLlama's `yields.llama.fi/chart/{poolId}`).
 * Consumers can rely on points being ordered ascending by timestamp.
 */
export interface TPoolTvlPoint {
  /** Unix seconds of the snapshot. */
  readonly timestamp: bigint;

  /** USD TVL at `USD_DECIMALS` (6). */
  readonly tvlUsd: bigint;
}

// app/core/shared/types/token_price.type.ts

import type { TAddress } from './address.type';

/**
 * USD price of one whole token, as reported by a market-data provider
 * (TVL-ROADMAP.md §3.2 — DefiLlama `coins.llama.fi` today).
 *
 * Scale conventions:
 *   - `usdPrice` is fixed-point at `TOKEN_PRICE_DECIMALS = 18`
 *     (1797.89 USD → 1797896200000000000000n). Prices multiply raw
 *     token amounts, so they share the 1e18 scale used by `Price`,
 *     `APR_SCALE` and `virtualReservesInUsd`.
 *   - `confidence` is the provider's ∈ [0,1] confidence at 1e18.
 *   - `timestamp` is the observation time, Unix seconds.
 *
 * A token the provider doesn't know is represented by *absence* from
 * `IMarketDataProvider.getTokenPrices(...)` — never by a zero or
 * fabricated price.
 */

/** Decimals of `TTokenPrice.usdPrice` (fixed-point USD). */
export const TOKEN_PRICE_DECIMALS = 18;

export interface TTokenPrice {
  /** The token this price belongs to. */
  readonly token: TAddress;

  /** USD price of one whole token, at 1e18 fixed-point. */
  readonly usdPrice: bigint;

  /** Provider confidence ∈ [0,1], at 1e18 fixed-point. */
  readonly confidence: bigint;

  /** Unix seconds of the price observation. */
  readonly timestamp: bigint;
}

// app/core/shared/utils/usd.util.ts

/**
 * USD money conventions for market data (TVL-ROADMAP.md §5.1).
 *
 * Every USD amount that crosses a provider boundary is a bigint scaled
 * by `USD_DECIMALS = 6` (USDC-like). JSON APIs (DefiLlama) hand out JS
 * floats, so `toUsdBigint` is the *only* sanctioned float → bigint door
 * for money: it throws on non-finite/negative input so a malformed
 * payload cannot silently corrupt a pool snapshot.
 *
 * Rationale for 6 decimals: `Math.round(value * 1e6)` is exact for the
 * magnitudes DefiLlama reports (verified with 88992532.21365), and it
 * matches USDC's own precision, so amounts compose without rescaling.
 */

/** Decimal places of every USD amount in Core (USDC-like). */
export const USD_DECIMALS = 6;

/** 10^USD_DECIMALS — one micro-USD step. */
export const USD_SCALE = 1_000_000n;

/**
 * Convert a JS float USD amount (e.g. straight from a JSON payload) to
 * a bigint at `USD_SCALE` (micro-USD units).
 *
 * Precision: exact for |value| below ~9e10 — far past the magnitudes
 * DefiLlama reports (verified: 88992532.21365 → 88992532213650n).
 *
 * @param value - USD amount as a float.
 * @returns The amount in micro-USD (`USD_SCALE`) units.
 * @throws When `value` is NaN/±Infinity or negative.
 */
export function toUsdBigint(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Error(`toUsdBigint: value must be finite, got ${value}`);
  }

  if (value < 0) {
    throw new Error(`toUsdBigint: value must be non-negative, got ${value}`);
  }

  return BigInt(Math.round(value * Number(USD_SCALE)));
}

/**
 * Format a bigint USD amount (in `USD_SCALE` units) as a display string
 * with `$`, thousands separators and `fractionDigits` decimals
 * (default 2). The fractional part is rounded half-up — unlike
 * `formatAmountShort`, which truncates: money displays round.
 *
 * Examples:
 *   formatUsd(88992532213650n)   -> "$88,992,532.21"
 *   formatUsd(1500000n)          -> "$1.50"
 *   formatUsd(1999999n)          -> "$2.00"
 *   formatUsd(1500000n, 0)       -> "$2"
 *   formatUsd(1234567n, 8)       -> "$1.23456700"
 *
 * @param value - USD amount at `USD_SCALE` (micro-USD units).
 * @param fractionDigits - Display decimals (0–8 sensible; values above
 *   `USD_DECIMALS` are zero-padded).
 * @throws When `fractionDigits` is negative or not an integer.
 */
export function formatUsd(value: bigint, fractionDigits: number = 2): string {
  if (fractionDigits < 0 || !Number.isInteger(fractionDigits)) {
    throw new Error(
      `formatUsd: fractionDigits must be a non-negative integer, got ${fractionDigits}`,
    );
  }

  const isNegative = value < 0n;
  const abs = isNegative ? -value : value;

  let whole = abs / USD_SCALE;
  let fraction = abs % USD_SCALE;

  if (fractionDigits < USD_DECIMALS) {
    // Round the fractional part half-up to `fractionDigits` digits.
    const keptStep = 10n ** BigInt(USD_DECIMALS - fractionDigits);
    const rounded = ((fraction + keptStep / 2n) / keptStep) * keptStep;

    if (rounded >= USD_SCALE) {
      fraction = rounded - USD_SCALE;
      whole += 1n;
    }
    else {
      fraction = rounded;
    }
  }

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  if (fractionDigits === 0) {
    return isNegative ? `-$${wholeStr}` : `$${wholeStr}`;
  }

  const fractionStr = fractionDigits <= USD_DECIMALS
    ? (fraction / 10n ** BigInt(USD_DECIMALS - fractionDigits))
        .toString()
        .padStart(fractionDigits, '0')
    : fraction
        .toString()
        .padStart(USD_DECIMALS, '0')
        .padEnd(fractionDigits, '0');

  return isNegative
    ? `-$${wholeStr}.${fractionStr}`
    : `$${wholeStr}.${fractionStr}`;
}

// app/core/shared/value_objects/pool_liquidity.value-object.ts

import { POOL_LIQUIDITY_SOURCES } from '../types';

import type { TAddress, TPoolLiquidity, TPoolLiquiditySource } from '../types';

/**
 * Immutable value object wrapping a market-level pool liquidity
 * snapshot (TVL-ROADMAP.md §5.1). Validates the snapshot at
 * construction so a malformed provider payload can never reach the
 * application layer: non-negative USD amounts, a known `source`, a
 * positive timestamp, a plausible pool address and a positive chain id.
 *
 * Acts as the canonical "what the market says about this pool's
 * liquidity" handle inside the domain layer — the TVL sibling of
 * {@link PoolStateVO}.
 */
export class PoolLiquidityVO {
  /** Pool contract address. */
  readonly pool: TAddress;

  /** EVM chain id the pool lives on. */
  readonly chainId: number;

  /** Adapter/protocol id, e.g. `'uniswap-v3'`. */
  readonly protocolId: string;

  /** Total value locked, USD at `USD_DECIMALS` (6). `0n` = unknown. */
  readonly tvlUsd: bigint;

  /** 24h volume, USD at `USD_DECIMALS` (6). `0n` = unknown. */
  readonly volume24hUsd: bigint;

  /** External pool id (DefiLlama UUID) when matched in the index. */
  readonly externalPoolId?: string;

  /** Where the numbers came from (see `POOL_LIQUIDITY_SOURCES`). */
  readonly source: TPoolLiquiditySource;

  /** Unix seconds of the snapshot. */
  readonly timestamp: bigint;

  constructor(data: TPoolLiquidity) {
    if (typeof data.pool !== 'string' || !data.pool.startsWith('0x') || data.pool.length <= 2) {
      throw new Error(
        `PoolLiquidityVO: pool must be a 0x address, got ${String(data.pool)}`,
      );
    }

    if (!Number.isInteger(data.chainId) || data.chainId <= 0) {
      throw new Error(
        `PoolLiquidityVO: chainId must be a positive integer, got ${data.chainId}`,
      );
    }

    if (typeof data.protocolId !== 'string' || data.protocolId.length === 0) {
      throw new Error(
        'PoolLiquidityVO: protocolId must be a non-empty string',
      );
    }

    if (data.tvlUsd < 0n) {
      throw new Error(
        `PoolLiquidityVO: tvlUsd must be non-negative, got ${data.tvlUsd}`,
      );
    }

    if (data.volume24hUsd < 0n) {
      throw new Error(
        `PoolLiquidityVO: volume24hUsd must be non-negative, got ${data.volume24hUsd}`,
      );
    }

    if (!POOL_LIQUIDITY_SOURCES.includes(data.source)) {
      throw new Error(
        `PoolLiquidityVO: unknown source "${String(data.source)}" `
        + `(known: ${POOL_LIQUIDITY_SOURCES.join(', ')})`,
      );
    }

    if (data.timestamp <= 0n) {
      throw new Error(
        `PoolLiquidityVO: timestamp must be positive, got ${data.timestamp}`,
      );
    }

    if (
      data.externalPoolId !== undefined
      && (typeof data.externalPoolId !== 'string' || data.externalPoolId.length === 0)
    ) {
      throw new Error(
        'PoolLiquidityVO: externalPoolId, when present, must be a non-empty string',
      );
    }

    this.pool = data.pool;
    this.chainId = data.chainId;
    this.protocolId = data.protocolId;
    this.tvlUsd = data.tvlUsd;
    this.volume24hUsd = data.volume24hUsd;
    this.externalPoolId = data.externalPoolId;
    this.source = data.source;
    this.timestamp = data.timestamp;
  }

  /**
   * Whether the snapshot is older than `maxAgeSeconds` (boundary is
   * exclusive: exactly `maxAgeSeconds` old is still fresh).
   *
   * @param maxAgeSeconds - Freshness window, Unix seconds.
   * @param now - Current time override, Unix seconds. Defaults to the
   *   wall clock; tests pass an explicit value for determinism.
   * @throws When `maxAgeSeconds` is negative.
   */
  isStale(
    maxAgeSeconds: bigint,
    now: bigint = BigInt(Math.floor(Date.now() / 1000)),
  ): boolean {
    if (maxAgeSeconds < 0n) {
      throw new Error(
        `PoolLiquidityVO.isStale: maxAgeSeconds must be non-negative, got ${maxAgeSeconds}`,
      );
    }

    return now - this.timestamp > maxAgeSeconds;
  }
}

// app/core/test/math/fee_apr.test.ts

/**
 * Slice 0 (TVL-ROADMAP.md §6) — fee-APR-from-turnover math:
 *   - hand-verified APRs for known volume/TVL/fee triples
 *   - degradation rules (zero volume → 0n; invalid inputs throw)
 *   - the annualization helper
 *
 * Pure bigint math — no network.
 *
 * Note: the roadmap's §6 example ("volume=10M, tvl=100M, fee=0.05% →
 * 18.25%/yr") contained an arithmetic slip: (0.1 × 0.0005 × 365) =
 * 1.825%, not 18.25%. The tests below assert the correct value; the
 * 18.25% case is included separately with volume equal to TVL.
 */

import { describe, expect, it } from 'vitest';

import { APR_SCALE, annualizeDailyRate, feeAprFromTurnover } from '@core/math';

const USD = 1_000_000n; // one USD at USD_DECIMALS (6)

describe('feeAprFromTurnover', () => {
  it('10M 24h volume over 100M TVL at 0.05% fee → 1.825% APR', () => {
    const apr = feeAprFromTurnover(
      10_000_000n * USD,
      100_000_000n * USD,
      0.0005,
    );
    // (10/100) × 0.0005 × 365 = 0.01825
    expect(apr).toBe(18_250_000_000_000_000n);
  });

  it('100M 24h volume over 100M TVL at 0.05% fee → 18.25% APR', () => {
    const apr = feeAprFromTurnover(
      100_000_000n * USD,
      100_000_000n * USD,
      0.0005,
    );
    // (100/100) × 0.0005 × 365 = 0.1825
    expect(apr).toBe(182_500_000_000_000_000n);
  });

  it('accepts feeRate as pool.fee / 1e6 (Shadow CL 0.24% tier = 2400)', () => {
    const apr = feeAprFromTurnover(
      50_000_000n * USD,
      10_000_000n * USD,
      2400 / 1_000_000,
    );
    // (50/10) × 0.0024 × 365 = 4.38 → 438%/yr
    expect(apr).toBe(4_380_000_000_000_000_000n);
  });

  it('unknown volume (0n) yields 0n — the caller keeps its prior', () => {
    expect(feeAprFromTurnover(0n, 100_000_000n * USD, 0.0005)).toBe(0n);
  });

  it('throws when TVL is zero or negative (caller must fall back first)', () => {
    expect(() => feeAprFromTurnover(1n, 0n, 0.0005)).toThrow(/tvlUsd/);
    expect(() => feeAprFromTurnover(1n, -1n, 0.0005)).toThrow(/tvlUsd/);
  });

  it('throws on negative volume', () => {
    expect(() => feeAprFromTurnover(-1n, 100_000_000n * USD, 0.0005)).toThrow(/volume24hUsd/);
  });

  it('throws on feeRate outside (0, 1) or non-finite', () => {
    const badRates = [0, -0.01, 1, 2.5, Number.NaN, Number.POSITIVE_INFINITY];

    for (const bad of badRates) {
      expect(() => feeAprFromTurnover(1n, 100n, bad)).toThrow(/feeRate/);
    }
  });
});

describe('annualizeDailyRate', () => {
  it('multiplies a daily rate by 365 by default', () => {
    const daily = 5n * 10n ** 14n; // 0.05%/day
    expect(annualizeDailyRate(daily)).toBe(daily * 365n);
  });

  it('honors a custom days-per-year', () => {
    expect(annualizeDailyRate(APR_SCALE, 100n)).toBe(100n * APR_SCALE);
  });

  it('accepts a zero daily rate', () => {
    expect(annualizeDailyRate(0n)).toBe(0n);
  });

  it('throws on negative rate or non-positive days', () => {
    expect(() => annualizeDailyRate(-1n)).toThrow(/dailyRate/);
    expect(() => annualizeDailyRate(1n, 0n)).toThrow(/daysPerYear/);
  });
});

// app/core/test/math/virtual_reserves.test.ts

/**
 * Slice 0 (TVL-ROADMAP.md §6) — virtual-reserves math invariants:
 *   - the identity pair (L = 1e18, sqrtP = 2^96 → both legs 1e18)
 *   - price scaling (sqrtP = 4×2^96 → legs L/4 and 4L)
 *   - the x·y = L² invariant at an odd price (truncation-tolerant)
 *   - the amount0·price ≈ amount1 symmetry
 *   - USD valuation of both legs at 1e18-scaled prices (hand-computed)
 *   - zero/invalid inputs throw
 *
 * Pure bigint math — no network, fully deterministic.
 */

import { describe, expect, it } from 'vitest';

import { virtualReserves, virtualReservesInUsd } from '@core/math';

const Q96 = 2n ** 96n;
const Q192 = Q96 * Q96;
const L = 1_000_000_000_000_000_000n; // 1e18

describe('virtualReserves', () => {
  it('identity pair: L=1e18 at price 1 → both legs are 1e18 raw', () => {
    const r = virtualReserves(L, Q96);
    expect(r.amount0Raw).toBe(L);
    expect(r.amount1Raw).toBe(L);
  });

  it('price 16 (sqrtP = 4×Q96): legs are L/4 and 4L', () => {
    const r = virtualReserves(L, Q96 * 4n);
    expect(r.amount0Raw).toBe(L / 4n);
    expect(r.amount1Raw).toBe(L * 4n);
  });

  it('invariant amount0Raw × amount1Raw = L² at an odd price', () => {
    const liq = 123_456_789_123_456_789n;
    const sqrtP = 7_922_816_251_426_433_759_354_395_033n; // ~0.84×2^96
    const r = virtualReserves(liq, sqrtP);

    const product = r.amount0Raw * r.amount1Raw;
    const lSquared = liq * liq;
    const diff = product > lSquared ? product - lSquared : lSquared - product;

    // Truncation error is bounded by ~2·L; relative error stays far
    // below 1e-12. (diff × 1e12) / L² must integer-divide to zero.
    expect((diff * 1_000_000_000_000n) / lSquared).toBe(0n);
  });

  it('symmetry: amount0Raw valued at the pool price ≈ amount1Raw', () => {
    const liq = 987_654_321n;
    const sqrtP = 12_345_678_901_234_567_890_123_456_789n;
    const r = virtualReserves(liq, sqrtP);

    // price_raw = sqrtP² / 2^192 (token1_raw per token0_raw).
    const amount0ValuedInToken1 = (r.amount0Raw * sqrtP * sqrtP) / Q192;

    const diff = amount0ValuedInToken1 > r.amount1Raw
      ? amount0ValuedInToken1 - r.amount1Raw
      : r.amount1Raw - amount0ValuedInToken1;

    // Both legs represent the same value; only integer-division
    // truncation (< 2 raw units each) separates them.
    expect(diff <= 4n).toBe(true);
  });

  it('throws on zero/negative liquidity and sqrtPriceX96', () => {
    expect(() => virtualReserves(0n, Q96)).toThrow(/liquidity/);
    expect(() => virtualReserves(-5n, Q96)).toThrow(/liquidity/);
    expect(() => virtualReserves(L, 0n)).toThrow(/sqrtPriceX96/);
    expect(() => virtualReserves(L, -Q96)).toThrow(/sqrtPriceX96/);
  });
});

describe('virtualReservesInUsd', () => {
  it('values both legs at 1e18-scaled USD prices (USDC/WETH-like)', () => {
    // L = 1e18 at price 1 → legs are 1e18 raw each:
    //   leg0: 1e12 USDC (6d)  × $1     = $1e12 → 1e18 micro-USD
    //   leg1: 1 WETH     (18d) × $2000 = $2000 → 2e9 micro-USD
    const usd = virtualReservesInUsd(
      L,
      Q96,
      6,
      18,
      1_000_000_000_000_000_000n, // $1.00 at 1e18
      2_000_000_000_000_000_000_000n, // $2000 at 1e18
    );
    expect(usd).toBe(1_000_000_000_000_000_000n + 2_000_000_000n);
  });

  it('handles the mirrored decimals case (WETH/USDC order)', () => {
    // Same geometry, legs swapped: 1 WETH at $1500 + 1e12 USDC at $2.
    const usd = virtualReservesInUsd(
      L,
      Q96,
      18,
      6,
      1_500_000_000_000_000_000_000n, // $1500 at 1e18
      2_000_000_000_000_000_000n, // $2 at 1e18
    );
    // leg0: 1e18 raw (18d) × $1500 = $1500 → 1.5e9 micro-USD
    // leg1: 1e18 raw (6d)  × $2    = $2e12 → 2e18 micro-USD
    expect(usd).toBe(1_500_000_000n + 2_000_000_000_000_000_000n);
  });

  it('throws on invalid decimals', () => {
    expect(() => virtualReservesInUsd(L, Q96, -1, 18, 1n, 1n)).toThrow(/token0Decimals/);
    expect(() => virtualReservesInUsd(L, Q96, 6, 1.5, 1n, 1n)).toThrow(/token1Decimals/);
  });

  it('throws on non-positive token prices (caller must fall back, not fake)', () => {
    expect(() => virtualReservesInUsd(L, Q96, 6, 18, 0n, 1n)).toThrow(/token0Usd/);
    expect(() => virtualReservesInUsd(L, Q96, 6, 18, 1n, -1n)).toThrow(/token1Usd/);
  });
});

// app/core/test/shared/pool_liquidity_vo.test.ts

/**
 * Slice 0 (TVL-ROADMAP.md §6) — the PoolLiquidity value object:
 *   - valid construction exposes every field
 *   - malformed snapshots throw at construction (never leak upward)
 *   - staleness policy (strictly-older-than, boundary exclusive)
 *
 * Pure — no network.
 */

import { describe, expect, it } from 'vitest';

import type { TAddress } from '@core/shared/types';
import { PoolLiquidityVO } from '@core/shared/value_objects';
import { USD_SCALE } from '@core/shared/utils';

const BASE = {
  pool: '0x0000000000000000000000000000000000000001' as TAddress,
  chainId: 8453,
  protocolId: 'uniswap-v3',
  tvlUsd: 88_992_532n * USD_SCALE,
  volume24hUsd: 87_887_325n * USD_SCALE,
  source: 'defi-llama' as const,
  timestamp: 1_795_000_000n,
};

describe('PoolLiquidityVO', () => {
  it('exposes all snapshot fields', () => {
    const vo = new PoolLiquidityVO({ ...BASE, externalPoolId: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' });

    expect(vo.pool).toBe(BASE.pool);
    expect(vo.chainId).toBe(BASE.chainId);
    expect(vo.protocolId).toBe(BASE.protocolId);
    expect(vo.tvlUsd).toBe(BASE.tvlUsd);
    expect(vo.volume24hUsd).toBe(BASE.volume24hUsd);
    expect(vo.externalPoolId).toBe('a1b2c3d4-e5f6-7890-abcd-ef0123456789');
    expect(vo.source).toBe('defi-llama');
    expect(vo.timestamp).toBe(BASE.timestamp);
  });

  it('allows unknown USD amounts (0n) and a missing external id', () => {
    const vo = new PoolLiquidityVO({ ...BASE, tvlUsd: 0n, volume24hUsd: 0n });

    expect(vo.tvlUsd).toBe(0n);
    expect(vo.volume24hUsd).toBe(0n);
    expect(vo.externalPoolId).toBeUndefined();
  });

  it('throws on negative USD amounts', () => {
    expect(() => new PoolLiquidityVO({ ...BASE, tvlUsd: -1n })).toThrow(/tvlUsd/);
    expect(() => new PoolLiquidityVO({ ...BASE, volume24hUsd: -1n })).toThrow(/volume24hUsd/);
  });

  it('throws on an unknown source', () => {
    expect(() => new PoolLiquidityVO({ ...BASE, source: 'made-up' as never })).toThrow(/source/);
  });

  it('throws on a bad pool address, chainId, protocol or timestamp', () => {
    expect(() => new PoolLiquidityVO({ ...BASE, pool: 'nope' as never })).toThrow(/pool/);
    expect(() => new PoolLiquidityVO({ ...BASE, chainId: 0 })).toThrow(/chainId/);
    expect(() => new PoolLiquidityVO({ ...BASE, chainId: 1.5 })).toThrow(/chainId/);
    expect(() => new PoolLiquidityVO({ ...BASE, protocolId: '' })).toThrow(/protocolId/);
    expect(() => new PoolLiquidityVO({ ...BASE, timestamp: 0n })).toThrow(/timestamp/);
  });

  it('throws on an empty externalPoolId', () => {
    expect(() => new PoolLiquidityVO({ ...BASE, externalPoolId: '' })).toThrow(/externalPoolId/);
  });

  it('isStale: strictly older than the window (boundary exclusive)', () => {
    const vo = new PoolLiquidityVO(BASE);

    expect(vo.isStale(3_600n, BASE.timestamp + 60n)).toBe(false); // fresh
    expect(vo.isStale(3_600n, BASE.timestamp + 3_600n)).toBe(false); // exactly at the limit
    expect(vo.isStale(3_600n, BASE.timestamp + 3_601n)).toBe(true); // one second past
  });

  it('isStale: defaults to the wall clock when no `now` is passed', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));

    const fresh = new PoolLiquidityVO({ ...BASE, timestamp: now - 60n });
    const stale = new PoolLiquidityVO({ ...BASE, timestamp: now - 7_200n });

    expect(fresh.isStale(3_600n)).toBe(false);
    expect(stale.isStale(3_600n)).toBe(true);
  });

  it('isStale throws on a negative window', () => {
    expect(() => new PoolLiquidityVO(BASE).isStale(-1n, 0n)).toThrow(/maxAgeSeconds/);
  });
});

// app/core/test/shared/usd.util.test.ts

/**
 * Slice 0 (TVL-ROADMAP.md §6) — USD money conversions and formatting:
 *   - the single float→bigint door for money (rounding + guards)
 *   - display formatting with rounding, separators and edge scales
 *
 * Pure — no network.
 */

import { describe, expect, it } from 'vitest';

import { USD_DECIMALS, USD_SCALE, formatUsd, toUsdBigint } from '@core/shared/utils';

describe('USD scale conventions', () => {
  it('USD_DECIMALS and USD_SCALE stay consistent', () => {
    expect(USD_DECIMALS).toBe(6);
    expect(USD_SCALE).toBe(10n ** 6n);
  });
});

describe('toUsdBigint', () => {
  it('converts float USD to micro-USD exactly', () => {
    expect(toUsdBigint(0)).toBe(0n);
    expect(toUsdBigint(1)).toBe(USD_SCALE);
    expect(toUsdBigint(1.5)).toBe(1_500_000n);
    expect(toUsdBigint(0.000001)).toBe(1n);
    expect(toUsdBigint(88_992_532.21365)).toBe(88_992_532_213_650n);
  });

  it('throws on non-finite or negative input', () => {
    expect(() => toUsdBigint(Number.NaN)).toThrow(/finite/);
    expect(() => toUsdBigint(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => toUsdBigint(Number.NEGATIVE_INFINITY)).toThrow(/finite/);
    expect(() => toUsdBigint(-0.5)).toThrow(/non-negative/);
  });
});

describe('formatUsd', () => {
  it('formats with separators and 2 fraction digits by default', () => {
    expect(formatUsd(0n)).toBe('$0.00');
    expect(formatUsd(USD_SCALE)).toBe('$1.00');
    expect(formatUsd(88_992_532_213_650n)).toBe('$88,992,532.21');
    expect(formatUsd(123_456_789_012_345n)).toBe('$123,456,789.01');
  });

  it('rounds half-up on the displayed fraction', () => {
    expect(formatUsd(1_234_500n)).toBe('$1.23'); // 1.2345 → 1.23 (4 < 5)
    expect(formatUsd(1_235_000n)).toBe('$1.24'); // 1.235 → 1.24 (half-up)
    expect(formatUsd(1_999_999n)).toBe('$2.00'); // carries into the whole part
  });

  it('supports 0 and >6 fraction digits', () => {
    expect(formatUsd(1_500_000n, 0)).toBe('$2'); // 1.5 rounds to 2
    expect(formatUsd(1_234_567n, 6)).toBe('$1.234567');
    expect(formatUsd(1_234_567n, 8)).toBe('$1.23456700');
  });

  it('formats negative amounts with a leading minus', () => {
    expect(formatUsd(-1_500_000n)).toBe('-$1.50');
  });

  it('throws on invalid fractionDigits', () => {
    expect(() => formatUsd(0n, -1)).toThrow(/fractionDigits/);
    expect(() => formatUsd(0n, 1.5)).toThrow(/fractionDigits/);
  });
});
