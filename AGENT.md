# AGENT.md — Coding Guide for Agents

> A practical guide for AI agents (and humans) working on the
> **Liquidity Position Analysis Engine** codebase.
> Read this **before** writing or modifying any code.

---

## 1. Project at a Glance

- **Stack**: Nuxt 4 + TypeScript + viem. Protocol-specific math uses
  `@uniswap/v3-sdk` + `@uniswap/sdk-core` (translation layer only — no
  SDK types leak past adapter boundaries). `jsbi` is a direct dev dep
  because pnpm's strict node_modules layout doesn't always expose it
  at the workspace root, and adapter code (`Position.fromAmount0`)
  imports from it directly. The vendor-neutral math layer
  (`app/core/math/`) ports V3's `TickMath.getSqrtRatioAtTick` and
  `sqrtPriceX96ToPrice` in-tree rather than depending on the SDK at
  runtime, and additionally implements IL, capital efficiency,
  realized volatility, APR, Sharpe-like scoring, `exp(x)` for bigint,
  and a full simulation engine (deposit, future price, historical
  replay, Monte Carlo) plus a recommendation engine with five
  concrete strategies (Balanced, MaximumFee, LowestRisk,
  HighestCapitalEfficiency, HighestSharpe) on top of the same
  scaffolding.
- **Type**: ESM (`"type": "module"`), strict TS, Vue 3 SFCs.
- **Domain**: Liquidity position analysis (Uniswap V3, Shadow, future CL AMMs).
- **Goal**: Provide LP analytics, recommendations, and simulations in a
  completely client-side, wallet-less, framework-agnostic Core.
- **Architectural style**: DDD + Hexagonal (Ports & Adapters).
- **Package manager**: **pnpm**. Use `pnpm install`, `pnpm add`, `pnpm dlx`,
  `pnpm run <script>`. Do **not** use `npm` or `yarn`. The lockfile is
  `pnpm-lock.yaml`; never commit `package-lock.json` or `yarn.lock`.
  Required tool: Node 18+ and a recent pnpm (Corepack-managed is fine).
  `pnpm-workspace.yaml` allows built scripts only for `esbuild` and
  `keccak` (keccak is required by ethers-v5 subdeps of the Uniswap SDKs);
  `.npmrc` sets `ignore-workspace-root-check=true` so `pnpm add` works
  against the root `package.json`.

The full vision lives in `README.md`. The five-sentence summary:

> Nuxt UI talks to an Application layer; the Application layer talks to
> Core domains; Core domains talk to Adapters/Providers through interfaces.
> Core **never** knows about Nuxt, viem, or any protocol SDK.

---

## 2. Folder Layout (must be respected)

```
app/
├── core/                        # framework-agnostic engine
│   ├── adapters/                # protocol implementations (Uniswap V3, Shadow, ...)
│   ├── providers/               # data sources (rpc, history, ...)
│   ├── application/             # use cases, services, orchestration  (PLANNED)
│   ├── domains/                 # pool, market, position, simulation, ...
│   ├── math/                    # pure math (tick math, IL, APR, CE, vol, score)
│   ├── shared/                  # types, interfaces, valueObjects, errors
│   ├── network/                 # network abstraction (chains + provider)
│   ├── protocols/               # protocol registry (which adapter per chain)
│   ├── services/                # composition root helpers (PLANNED)
│   └── index.ts                 # public exports
│
├── composables/                 # Nuxt composables (UI → Core bridge)
├── pages/                       # (PLANNED) routes
├── components/                  # (PLANNED) Vue components
└── plugins/                     # (PLANNED) Nuxt plugins
```

Path alias: `@core/*` → `app/core/*` (configured in `nuxt.config.ts`).
**All imports from `app/core/*` should use `@core/...`**, not relative
`../../../core/...` chains, when crossing module boundaries (e.g. from
`composables/` into `core/`). Inside `core/`, prefer relative paths.

---

## 3. The Non-Negotiable Dependency Rules

The Core must remain portable. Therefore, the following imports are
**forbidden** in the listed modules:

| Module | Must NOT import |
|---|---|
| `app/core/domains/**` | `adapters/**`, `providers/**`, `nuxt`, `vue`, `viem`, any protocol SDK |
| `app/core/math/**`    | `adapters/**`, `providers/**`, `nuxt`, `vue`, `viem` |
| `app/core/shared/**`  | any higher layer (domains, math, application, adapters, providers) |
| `app/core/adapters/**` | other adapters (no cross-protocol imports) |
| `app/core/providers/**` | other providers (no cross-source imports) |

Allowed flow:
```
Nuxt UI → Application → Domains → Math → Shared
            ├──────────► Adapters
            └──────────► Providers
Adapters ──► Providers (to read data; e.g. UniswapV3Adapter takes IRpcProvider)
```

**viem is allowed only inside `app/core/providers/rpc/**` and inside
adapter code that wraps protocol-specific SDKs.** Never in `domains/`,
`math/`, or `shared/`.

If you write code that violates any of these, stop and refactor.

---

## 4. Code Style

The codebase already follows a very specific style. **Match it
exactly** when adding files.

### 4.1 File-level comments
Every file starts with a path comment that matches the actual
snake_case filename:
```ts
// app/core/adapters/uniswap/v3/uniswap_v3_adapter.class.ts
```
Place it on line 1, no blank line before the first import.

### 4.2 Imports
- One blank line between the path comment and the first import.
- Imports are **grouped by source** (external → internal), separated by a
  blank line.
- Type-only imports use `import type { ... }` — they go **after** value
  imports within the same group.
- Sub-groups (e.g. `import type { X }` after value imports) are also
  separated by a blank line.
- Internal imports use `@core/...` alias when crossing top-level
  boundaries, otherwise relative paths.

Example (illustrative — when this convention is fully applied, the
file will be `uniswap_v3_adapter.class.ts`):
```ts
// app/core/adapters/uniswap/v3/uniswap_v3_adapter.class.ts

import type { IRpcProvider } from '@core/providers/rpc';
import type { IProtocolAdapter } from '@core/adapters/protocol_adapter.interface';

import type {
  TPoolDiscovery,
  TPoolState,
  TQuotePosition,
  TTick,
  TTickRange,
} from '../../types';

import type { TAddress } from '@core/shared/types';
```

### 4.3 Class member layout
Inside classes, members follow this order, each **separated by a
blank line**:
1. `readonly` properties (`id`, `name`, `version`).
2. Constructor.
3. Public methods.
4. Private helpers.

Example:
```ts
export class UniswapV3Adapter implements IProtocolAdapter {
  readonly id = 'uniswap-v3';

  readonly name = 'Uniswap V3';

  readonly version = '3';

  constructor(
    private readonly rpc: IRpcProvider,
  ) {}

  async discoverPools(...) { ... }

  private createRpc(network: any) { ... }
}
```

### 4.4 Method parameter formatting
- Multi-line parameters are **one per line**, indented **2 spaces** beyond
  the opening paren.
- Closing `): ReturnType {` is on its own line.

```ts
  async getPoolState(
    pool: TAddress,
  ): Promise<TPoolState> {
    throw new Error('Not implemented');
  }
```

### 4.5 Type declarations
- Prefer `interface` for object shapes, `type` for unions/aliases/utility
  types.
- Identifier prefixes (also covered in §4.10):
  - **`I*`** for interfaces that describe **behavior/contracts**:
    `IRpcProvider`, `IHistoryProvider`, `IProtocolAdapter`,
    `INetworkProvider`, `IProtocol`, `IProtocolRegistry`,
    `INetworkRegistry`.
  - **`T*`** for protocol-neutral types and shapes: `TPoolState`,
    `TTick`, `TNetwork`, `TAddress`, `THex`, `TBlockRange`, `TProtocol`,
    `TQuotePosition`, `TPoolDiscovery`.
  - **No prefix** for concrete classes: `RpcProvider`, `NetworkProvider`,
    `UniswapV3Adapter`, `ShadowAdapter`.
- Use `bigint` for all on-chain integer values (token amounts, ticks
  expressed as `sqrtPriceX96`, block numbers, balances). Never `number`
  for these.
- Addresses / hashes are template-literal types: `` `0x${string}` ``
  (see `TAddress`, `THex`).
- The `T*` vs `I*` split is deliberate: if a type is a **data shape
  only**, use `T*`; if it has methods (behavior), use `I*` even if it
  also has fields.

### 4.6 Strictness
- TypeScript is strict. Do not add `any` unless you are inside the
  boundaries of the generic `IRpcProvider.readContract<...>` and the
  return is genuinely unknown — and even then, prefer `unknown` and cast
  in the adapter.
- No `// @ts-ignore`, no `as any`. Use narrow `as` casts with a comment
  explaining why.
- All async functions are explicitly `Promise<...>`.

### 4.7 Index / barrel files
Every folder exposes a barrel `index.ts` that re-exports the public
surface only. The `index.ts` is the **only** file external code should
import from, **except** when a file needs a sub-path not re-exported
(common for very large modules — prefer adding to the barrel).

Order inside an `index.ts`:
1. Interfaces first
2. Classes
3. Factory functions
4. Sub-module re-exports
5. JSDoc examples (if any) at the bottom, as a `/** ... */` block

### 4.8 Error handling
- Throw `new Error('descriptive message')` for invariant violations
  (unknown protocol, unknown network, missing config).
- Do not swallow errors.
- Do not couple to viem error types in Core code; let them bubble.

### 4.9 Comments
- File path comment on every file.
- Short JSDoc on exported interfaces and on factory functions.
- No `console.log` in Core code. Use the UI layer.
- No trailing whitespace, files end with a single newline.

### 4.10 Naming conventions

**Folders** (apply everywhere)
- Always lowercase, no separators: `adapters`, `providers`, `history`,
  `rpc`, `pool`, `position`.
- **Adapter folders** use the protocol name in lowercase, with a
  version sub-folder when relevant: `uniswap/v3/`, `shadow/`.

**Files inside `app/core/`** — `<file-name>.<role>.ts`

Inside `app/core/**` the filename **must** be structured as
`<file-name>.<role>.ts`, where:

- `<file-name>` is **snake_case** (lowercase words joined by `_`).
- `<role>` is one of the postfixes below, describing the single thing
  the file contains.
- The **identifier** inside the file follows §4.5: `I*` for behavior
  contracts, `T*` for shapes, PascalCase for classes — the filename is
  snake_case regardless.

| File kind | Postfix | Example filename | Contains |
|---|---|---|---|
| Interface | `.interface.ts` | `protocol_adapter.interface.ts` | `IProtocolAdapter` |
| Class (concrete impl) | `.class.ts` | `rpc_provider.class.ts` | `RpcProvider` |
| Factory function | `.factory.ts` | `create_rpc_provider.factory.ts` | `createRpcProvider` |
| Type / data shape (no behavior) | `.type.ts` | `pool_state.type.ts` | `TPoolState` |
| Constants / static data | `.const.ts` | `sonic.const.ts` | `sonic: TNetwork` |
| Value object | `.value-object.ts` | `tick_range.value-object.ts` | `TickRange` class |
| Error class | `.error.ts` | `unknown_protocol.error.ts` | `UnknownProtocolError` |
| Utility / pure helper | `.util.ts` | `format_units.util.ts` | `formatUnits` |
| Barrel (folder root) | `index.ts` | `index.ts` | re-exports |

**Identifiers inside the file** (always, not just in `core/`)
- **Interfaces that describe behavior**: PascalCase, **prefixed with `I`**
  — `IProtocolAdapter`, `IRpcProvider`, `INetworkProvider`,
  `IProtocolRegistry`, `IHistoryProvider`.
- **Types that describe pure shapes / data**: PascalCase, **prefixed with
  `T`** — `TPoolState`, `TTick`, `TNetwork`, `TAddress`, `THex`,
  `TBlockRange`, `TProtocol`, `TQuotePosition`, `TPoolDiscovery`.
- **Concrete classes**: PascalCase, **no prefix** — `RpcProvider`,
  `NetworkRegistry`, `UniswapV3Adapter`, `ShadowAdapter`.
- **Factory functions**: `camelCase`, prefixed with `create*` —
  `createRpcProvider`, `createNetworkProvider`, `createProtocolManager`.
- **Composable functions**: `camelCase`, prefixed with `use*` — `useRpc`,
  `useNetwork`.
- On-chain integer values: `bigint`. Never `number` for amounts, ticks
  as `sqrtPriceX96`, block numbers, balances, etc.

**Files outside `app/core/`** (composables, components, pages, plugins,
middlewares, utils, configs) — Nuxt 4 / Vue 3 conventions

The strict `<file-name>.<role>.ts` rule is for the Core only, where
consistency and predictability matter most. Outside `app/core/` the
filename follows **standard Nuxt 4 / Vue 3 conventions** so the
auto-import layer, IDE tooling, and `vue-tsc` work out of the box
without custom mappings. Use the right convention for the right
folder:

| Kind | Convention | Example filename | Auto-import name |
|---|---|---|---|
| Nuxt composable | `<thing>.ts` (or kebab-case `<thing>.ts`) — `use*` prefix is conventional but not enforced by the filename | `useCoreServices.ts`, `use_pool_lookup.ts` | `useCoreServices`, `usePoolLookup` |
| Vue component | `PascalCase.vue` (kebab-case also accepted) | `PoolCard.vue`, `pool-card.vue` | `<PoolCard/>`, `<PoolCard>` |
| Vue page | kebab-case route segments + dynamic brackets | `index.vue`, `pool/[pool].vue`, `pool/[pool]/simulation.vue` | (route path) |
| Vue layout | kebab-case | `default.vue`, `docs.vue` | (Nuxt layout name) |
| Nuxt plugin | `<thing>.ts` (universal) or `<thing>.client.ts` / `<thing>.server.ts` (side-specific) | `core.client.ts`, `analytics.server.ts` | `$<thing>` |
| Nuxt middleware | `<thing>.ts` (named) or `<thing>.global.ts` (global) | `auth.global.ts`, `pool.ts` | (Nuxt middleware name) |
| Utility helper | kebab-case or single word | `format.ts`, `format-dto.ts` | (auto-imported) |
| Test | kebab-case `<thing>.spec.ts` | `rpc-provider.spec.ts` | (Vitest / similar) |

**Nuxt-side rules of thumb**

- Nuxt 4 **auto-imports** anything in `app/composables/`,
  `app/utils/`, `app/components/`, `app/layouts/`, `app/middleware/`,
  and `app/plugins/`. Prefer auto-imports over manual
  `import { ... } from '~/composables/<thing>'` lines.
- The identifier inside a composable file should still be
  `camelCase` and start with `use*` (e.g. `useCoreServices`,
  `usePoolLookup`) regardless of the filename — that's what Nuxt
  binds to the auto-import.
- Components keep `PascalCase` so the auto-imported template tag
  matches (`<PoolCard/>`). The kebab-case `<pool-card/>` form is
  still accepted in templates.
- For client-only plugin code that pulls in viem + adapters, use
  `<thing>.client.ts`. For universal plugin code, use `<thing>.ts`.
  Never put side-specific imports in a universal plugin.

> **Why this asymmetry?** The Core is consumed by every other layer
> and must stay refactor-friendly. The UI layer is more fluid and
> Vue/Nuxt conventions dominate there — fighting them costs more
> than it saves.

**Why this matters**
- Filename tells you what's inside at a glance, even without opening
  the file.
- Refactors (renaming classes) don't force mass renames of files.
- Search by kind: `rg "_factory\.ts$"` finds every factory,
  `rg "\.interface\.ts$"` finds every interface, `rg "_class\.ts$"`
  finds every class.

**Examples** (all inside `app/core/`)

```ts
// app/core/providers/rpc/rpc_provider.interface.ts
export interface IRpcProvider { ... }

// app/core/providers/rpc/rpc_provider.class.ts
export class RpcProvider implements IRpcProvider { ... }

// app/core/providers/rpc/create_rpc_provider.factory.ts
export function createRpcProvider(opts: ICreateRpcProviderOptions) { ... }

// app/core/shared/types/address.type.ts
export type TAddress = `0x${string}`;

// app/core/shared/types/pool_state.type.ts
export interface TPoolState { ... }

// app/core/network/networks/sonic.const.ts
export const sonic: TNetwork = { ... };
```

---

## 5. Architectural Patterns in Use

### 5.1 Factory functions
Composition is done via small `create*` factories that return a fully
wired instance. This keeps construction explicit and testable.

Examples already in the repo:
- `createRpcProvider({ chain, rpcUrl }) → RpcProvider`
- `createHistoryProvider(rpc) → RpcHistoryProvider`
- `createNetworkProvider(registry, chainId) → NetworkProvider`
- `createProtocolManager(registry, network) → ProtocolManager`

**Convention**: any new public composition helper should be a
`create*` factory, not a class with a singleton pattern.

### 5.2 Interfaces + concrete classes
Always define an `IFoo` interface describing behavior, and a
`Foo` class implementing it. Code outside the module depends on the
**interface**, not the class. This is what makes the Core swappable.

### 5.3 Registries
Registries are simple `Map`-backed classes:
- `NetworkRegistry` — keyed by `chainId: number`.
- `ProtocolRegistry` (in `adapters/`) — keyed by adapter `id: string`.
- `ProtocolRegistry` (in `protocols/`) — keyed by protocol `id: string`,
  scoped by `supportedChains`.

When adding a new registry, follow the same shape:
- `register(item)`, `unregister(id)?`, `get(id)`, `has(id)`, `all()`,
  plus domain-specific queries (e.g. `getByChain`).

### 5.4 The `Manager` pattern
`ProtocolManager` is the example to copy when exposing a domain with
multiple backends: it accepts a registry and a network provider, and
returns the right adapter for the current chain. Keep the surface
narrow — `adapters()`, `adapter(id)`.

### 5.5 Translation boundary
Adapters convert protocol-specific shapes into Core types (`TPoolState`,
`TTick`, `TQuotePosition`, `TPoolDiscovery`). **Never** leak SDK types
out of an adapter folder. Always translate inside the adapter before
returning.

### 5.5a Tick alignment convention
V3-class CL pools enforce `tickLower % tickSpacing === 0` (and likewise
for `tickUpper`). Adapters in this repo **auto-align** user-supplied
tick bounds to the pool's `tickSpacing` (via
`nearestUsableTick` from @uniswap/v3-sdk) inside the position quoter
and the tick reader. Callers don't need to know about
`tickSpacing` ahead of time. The aligned bounds are returned in the
result so callers can see the effective range.

### 5.6 Providers answer "where did the data come from?"
Two providers exist today:
- `RpcProvider` — wraps a viem `PublicClient`. The only place that knows
  about viem.
- `RpcHistoryProvider` — composes `IRpcProvider` to replay blocks/logs.

A future `DefiLlamaHistoryProvider` or `SubgraphProvider` would implement
the same `IHistoryProvider` / `IRpcProvider` interface.

### 5.7 Network ↔ RPC wiring
`NetworkProvider` holds a `TNetwork` and lazily builds an
`IRpcProvider` for it (via `defineChain` + `createRpcProvider`). It
exposes `.current()`, `.rpc()`, `.switch(chainId)`. The pattern is
already correct; reuse it when adding a "user-selected network" UI.

### 5.7a Tick math, ported
V3-class CL pools share the same `sqrtPriceX96 = sqrt(1.0001^tick) * 2^96`
invariant. To keep the math layer truly vendor-neutral, the iterative
algorithm from Uniswap's `TickMath.getSqrtRatioAtTick` is ported
line-for-line into `app/core/math/tick_math.util.ts`. Two important
caveats baked into the port so future maintainers don't trip on them:

- **Bigint right-shifts are 32-bit-safe.** JavaScript's `>>` operator
  on bigints converts the shift count via `ToInt32`, so
  `x >> (2n ** 128n) === x`. Use `x / (2n ** 128n)` (or the
  package-private `shr128()` helper) for the actual shift by 128.
- **The forward-mapping constants are a fixed list of 19 hex
  literals.** Do not change them without cross-checking against
  `@uniswap/v3-sdk`'s `TickMath`; the smoke tests cross-check the
  canonical ticks (`{-887272, -100000, -76500, 0, 1, 100, 100000,
  887272}`) against the SDK on every run.

### 5.7b File placement — where does a new `<thing>` go?

| Concept | Folder | Notes |
|---|---|---|
| Token balance, network meta, etc. | `app/core/shared/types/` | `T*` only, one type per file |
| Pool protocol-neutral state | `app/core/adapters/types/` | Fed by adapters, consumed by domains |
| Pool domain aggregate | `app/core/domains/pool/` | Wraps adapter state + ticks |
| Range candidates / LP strategies | `app/core/domains/recommendation/` | No RPC, no SDK |
| Deposit scenario models | `app/core/domains/simulation/` | Phase 3 ships `DepositSimulation` |
| Tick/pool math (sqrtPriceX96 etc.) | `app/core/math/tick_math.util.ts` | **Single allowed home for the V3 `>>`-style bigint constant tables** |
| Impermanent loss | `app/core/math/il.util.ts` | Pure; IL_SCALE = 1e18 == 100% |
| Capital efficiency | `app/core/math/capital_efficiency.util.ts` | CE = P_upper / P_lower; CAPITAL_EFFICIENCY_SCALE = 1e18 == 1× |
| Realized volatility | `app/core/math/volatility.util.ts` | Log-return stdev, annualized; VOLATILITY_SCALE = 1e18 == 100% |
| APR from observed fees | `app/core/math/apr.util.ts` | APR_SCALE = 1e18 == 100% APR |
| Sharpe-like composite | `app/core/math/scoring.util.ts` | SCORE_SCALE = 1e18 == 1.0 score unit |
| `exp(x)` for bigint fixed-point | `app/core/math/lnexp.util.ts` | Used by Monte Carlo + synthetic history; EXP_LN_SCALE = 1e18 |
| Level-1 deposit scenario | `app/core/domains/simulation/deposit_simulation.class.ts` | Phase 3 + Phase 5 |
| Level-2 future-price scenario | `app/core/domains/simulation/future_price_simulation.class.ts` | Phase 5 |
| Level-3 historical replay | `app/core/domains/simulation/historical_replay_simulation.class.ts` | Phase 5; takes `history` at construction |
| Level-4 Monte Carlo (GBM) | `app/core/domains/simulation/monte_carlo_simulation.class.ts` | Phase 5 |
| Range generator (candidate ticks) | `app/core/domains/recommendation/range_generator.interface.ts` + `*_range_generator.class.ts` | Pure; `IRangeGenerator` |
| Concrete recommendation strategies | `app/core/domains/recommendation/{balanced,highest_sharpe,maximum_fee,lowest_risk,highest_capital_efficiency}_strategy.class.ts` | `IRecommendationStrategy`; Phase 6 |
| Recommendation engine | `app/core/domains/recommendation/recommendation_engine.class.ts` | Orchestrator; Phase 6 |
| Recommendation value object | `app/core/domains/recommendation/recommendation.value-object.ts` | Immutable, ranked; Phase 6 |
| Recommendation set | `app/core/domains/recommendation/recommendation_set.value-object.ts` | Ordered list + context; Phase 6 |
| Scoring config | `app/core/domains/recommendation/scoring_config.value-object.ts` | Per-strategy weights + global knobs; Phase 6 |
| Display formatting helpers | `app/core/shared/utils/` | Bigint ↔ decimal string |
| Immutable wrappers (Price, TickRange) | `app/core/shared/value_objects/` | Always immutable; validate on `new` |
| Application-layer base error | `app/core/application/errors/use_case_error.ts` | Abstract; carries stable `code` string + sets `name = new.target.name` |
| Application-layer input errors | `app/core/application/errors/invalid_input_error.ts` | `InvalidUseCaseInputError` — `code = 'invalid-input'` |
| Application-layer missing-history | `app/core/application/errors/missing_history_error.ts` | `MissingPoolHistoryError` — `code = 'missing-pool-history'` |
| Application-layer adapter lookup | `app/core/application/errors/adapter_not_found_error.ts` | `AdapterNotFoundError` — `code = 'adapter-not-found'` |
| Application DTOs | `app/core/application/dtos/` | Protocol-neutral, UI-ready plain objects + bigints |
| Use cases | `app/core/application/use_cases/` | One `*.use_case.ts` per use case; Phase 7 |
| Use case adapter resolver | `app/core/application/use_cases/adapter_resolver.type.ts` | Shared `TAdapterResolver` injected into use cases |
| Composition root class | `app/core/services/core_services.class.ts` | `CoreServices` — bundles RPC + adapters + analytics; Phase 7 |
| Composition root factory | `app/core/services/create_core_services.factory.ts` | `createCoreServices({network, adapters?, analytics?, pickAdapter?})` |
| Default adapter picker | `app/core/services/core_services.class.ts` (exported) | `defaultAdapterPicker(chainId, protocolId, registered)`; protocolId exact → first registered |

---

## 6. Module Reference

### 6.1 `app/core/shared/types/`
Pure data shapes. No logic. **One type per file**, snake_case + `.type.ts`.
The list today:
- `address.type.ts` → `TAddress` — `` `0x${string}` ``
- `hex.type.ts` → `THex` — `` `0x${string}` ``
- `chain_id.type.ts` → `TChainId` — `number`
- `block_range.type.ts` → `TBlockRange` — `{ fromBlock, toBlock, step: bigint }`
- `protocol_id.type.ts` → `TProtocolId` — `string`
- `network.type.ts` → `TNetwork` — chain metadata
- `protocol.type.ts` → `TProtocol` — protocol metadata

When adding a new shared type, follow the **one type per file** pattern
with a leading path comment, and snake_case the filename.

### 6.2 `app/core/providers/rpc/`
- `rpc_provider.interface.ts` → `IRpcProvider` — interface
  (readContract, multicall, getBlock, getBlockNumber, getLogs,
  getTransactionReceipt, getCode, getBalance).
- `rpc_provider.class.ts` → `RpcProvider` — viem-backed implementation.
- `create_rpc_provider.factory.ts` → `createRpcProvider({ chain, rpcUrl })` — factory.

### 6.3 `app/core/providers/history/`
- `history_provider.interface.ts` → `IHistoryProvider` —
  `replayBlocks`, `replayLogs`, `getBlock`, `getLatestBlockNumber`.
- `rpc_history_provider.class.ts` → `RpcHistoryProvider` — implementation.
- `create_history_provider.factory.ts` → `createHistoryProvider(rpc)` — factory.

### 6.4 `app/core/network/`
- `TNetwork` definition in `shared/types/network.type.ts`.
- `network_provider.interface.ts` / `network_registry.interface.ts` — interfaces.
- `network_provider.class.ts` / `network_registry.class.ts` — implementations.
- `create_network_provider.factory.ts` — factory.
- `networks/{ethereum,sonic,arbitrum,base}.const.ts` — static network
  list (`.const.ts` because each is a single exported constant).

### 6.5 `app/core/protocols/`
- `protocol.interface.ts` → `IProtocol` — `{ metadata: TProtocol; adapter: IProtocolAdapter }`.
- `protocol_registry.class.ts` → `ProtocolRegistry` — manages `IProtocol`s.
- `protocol_manager.class.ts` → `ProtocolManager` — picks the right adapter
  for the current chain.
- `create_protocol_manager.factory.ts` → `createProtocolManager(...)` — factory.

### 6.6 `app/core/adapters/`
- `protocol_adapter.interface.ts` → `IProtocolAdapter` — see README:
  `discoverPools`, `getPoolState`, `getTicks`, `quotePosition`.
- `index.ts` — re-exports `IProtocolAdapter`, the `types` module, and
  the per-protocol sub-modules under namespaced `export * as` so
  callers can write `@core/adapters` (root), `@core/adapters/uniswap/v3`
  or `@core/adapters` namespace (`UniswapV3.createUniswapV3Adapter`).
- `types/` — leaf type files:
  - `tick.type.ts` → `TTick`
  - `tick_range.type.ts` → `TTickRange`
  - `quote_position.type.ts` → `TQuotePosition`
  - `pool_discovery.type.ts` → `TPoolDiscovery`
  - `pool_state.type.ts` → `TPoolState`
- `uniswap/v3/` — full Uniswap V3 adapter (Phase 2). Substructure:
  - `abi/uniswap_v3_pool.abi.ts`, `abi/uniswap_v3_factory.abi.ts`,
    `abi/erc20.abi.ts` — minimal ABI fragments.
  - `addresses/uniswap_v3_factory_addresses.const.ts` — per-chain
    factory address registry (mainnet, arbitrum, base).
  - `tokens/token_resolver.class.ts` — batched ERC20 metadata reads
    via `IRpcProvider.multicall`.
  - `pools/pool_state_reader.class.ts` — translates `slot0` +
    `liquidity` + `feeGrowth*X128` + `ticks(tick)` reads into
    `TPoolState` / `TTick`. Aligns input ticks to the pool's
    `tickSpacing` via `nearestUsableTick` from @uniswap/v3-sdk.
  - `pools/pool_position_quoter.class.ts` — wraps `Position.fromAmount0`
    + `Position.mintAmounts` from @uniswap/v3-sdk and emits
    `TQuotePosition`. Tick bounds auto-aligned.
  - `pools/pool_discovery.class.ts` — on-demand `factory.getPool(...)`.
  - `uniswap_v3_adapter.class.ts` — wires the helpers above into the
    `IProtocolAdapter` surface. Also exposes `resolvePool(tokenA,
    tokenB, fee)` for callers that already know the pair + fee tier.
  - `create_uniswap_v3_adapter.factory.ts` → `createUniswapV3Adapter`.
  - `index.ts` — barrel.
- `shadow/` — Shadow CL adapter mirror (Phase 2). Same internal
  structure as Uniswap V3 but with its own ABIs and
  `shadow_v3_factory_addresses.const.ts` (Sonic mainnet). Currently
  the canonical factory address is a placeholder and must be verified
  against Shadow docs before relying on it for production reads;
  the adapter is otherwise structurally complete.
- `sources/` (Phase 9 slice 6) — per-adapter **token** sources.
  The `ITokenSource` interface in `@core/shared/types`
  (`token_source.type.ts`) is a sibling concept to
  `IProtocolAdapter`: it answers "what tokens exist on this
  chain for this protocol?", not "how do I read a pool?". Two
  concrete implementations today:
  - `uniswap/v3/sources/uniswap_v3_token_source.ts` — pulls
    `cdn.jsdelivr.net/gh/Uniswap/default-token-list@main/src/tokens/{chain}.json`
    (with `raw.githubusercontent.com` fallback). 405 mainnet,
    17 Arbitrum, 96 Base.
  - `shadow/sources/shadow_token_source.ts` — pulls
    `https://api.shadow.so/tokens` (~20k Sonic tokens; logoURI
    synthesized from TrustWallet's CDN because the upstream
    doesn't ship one).
  Both are pure data — `fetch()` + a defensive parser, no
  `IRpcProvider`, no viem, no SDK. The `tokenSources` registry
  in `app/core/adapters/sources/index.ts` maps `protocolId`
  → source; `resolveTokenSource(protocolId)` is the lookup.
  `useTokenList` (in `app/composables/`) is the only consumer.
- Allowed internal cross-protocol dependency: Shadow's
  `abi/erc20.abi.ts` re-exports the ERC20 ABI fragment from
  `@core/adapters/uniswap/v3`. No other cross-adapter imports are
  permitted.

### 6.7 `app/composables/`
Thin glue between Nuxt and Core — composables live **outside
`app/core/`** and follow the Nuxt 4 conventions described in
§4.10 (PascalCase identifier, kebab-case or `use<Thing>.ts`
filename, no role postfix). Nuxt auto-imports every file in this
folder by its exported identifier.

Example: `useCoreServices.ts` calls
`createCoreServices({ network })` and returns it. Composables
**must not** contain business logic — they only build Core
objects and expose them to the UI.

#### Phase 8 inventory
The current set of composables (all universal — no `.client`
suffix because they're plain functions called from `<ClientOnly>`
wrappers in pages):
- `app/composables/useCoreServices.ts` — null-safe wrapper around
  `nuxtApp.$core`. Returns `CoreServices | null` during SSR.
- `app/composables/useNetworks.ts` — exports the frozen
  `BUNDLED_NETWORKS` list plus `useActiveNetwork()` which binds to
  `useCoreServices().network.current()`.
- `app/composables/useAdapters.ts` —
  `adapterForChain(chainId, protocolId?)` returns an
  `IProtocolAdapter` or `null`.
- `app/composables/usePoolLookup.ts` — bundles
  `lookupPool({ tokenA, tokenB, fee })` and `analyzePool(pool)`
  for the index page. Catches `AdapterNotFoundError` and surfaces
  it through `lastError`.
- `app/composables/useSessionState.ts` — Phase 9. Tiny
  client-only localStorage helper (`lp:v1:lastChainId`,
  `lp:v1:lastProtocolId`) for cross-reload session memory.
  Used by `DiscoverForm.vue` to seed the dropdowns and by
  `pages/pool/[pool].vue` to fill in `protocolId` for direct
  URL loads that omit the query param.
- `app/composables/useRpcOverride.ts` — Phase 9. Per-chain
  user-pinned RPC URLs in `localStorage` (`lp:v1:rpcOverrides`).
  Read by `app/plugins/core.client.ts` at boot and folded into
  `TNetwork.rpcUrls` (prepended, so the override wins) before
  the `NetworkProvider` is constructed. Edited from the UI by
  `app/components/RpcSettings.vue` (the slideover on the
  Discover page). This is the *only* RPC override path —
  there is no env-var escape hatch.
- `app/composables/useTokenList.ts` — Phase 9 slices 5 + 6.
  Reactive accessor for the active `(chainId, protocolId)`'s
  token universe. Starts from the static curated list
  (`app/data/tokens/curated.ts`) for an instant cold start,
  then upgrades in the background by asking the per-adapter
  `ITokenSource` registered under `protocolId` (Uniswap V3's
  `default-token-list` via JSDelivr CDN, or Shadow's
  `api.shadow.so/tokens`). Results are cached in
  `localStorage` (`lp:v1:tokens:{protocolId}:{chainId}`,
  24h TTL) and a `refresh()` method forces a cache-bypass
  refetch (used by the `Refresh tokens` button in the
  Discover form). Returns `{ tokens, isRefreshing, getToken,
  refresh }`. Failure paths (offline, 429, CORS block) keep
  the curated list and log a `console.warn` — the dropdown
  is never empty in practice.

### 6.8 `app/core/test/`
All tests live under `app/core/test/` (NOT at the repo root, NOT in
a top-level `scripts/` directory — that pattern was retired). The
test directory **mirrors the `app/core/` tree** so a reader can find
the test for a given module by walking the same path:

```
app/core/test/
├── _helpers.ts                            # shared LCG + buildSyntheticHistory
├── test-constants.ts                      # shared PRICE_DECIMALS = 18
├── scripts/
│   └── smoke.test.ts                      # root sanity (Uniswap V3 + Shadow wire-up)
├── domains/
│   ├── pool/pool.test.ts                  # Phase 3 — Core Domain wire-up
│   ├── simulation/simulation.test.ts      # Phase 5 — 4 simulation levels
│   └── recommendation/recommendation.test.ts # Phase 6 — recommendation engine
├── math/
│   └── math-engine.test.ts                # Phase 4 — math + analytics
└── application/
    └── use_cases/
        ├── use_cases.test.ts              # Phase 7 — 5 use cases + DTOs + errors
        └── get_pool_history.test.ts       # Phase 10 — GetPoolHistoryUseCase
```

Run the whole suite with `pnpm test` (which expands to
`vitest run`); a single file with
`pnpm test app/core/test/domains/pool/pool.test.ts`; the
interactive watch mode with `pnpm test:watch`; the Vitest UI
dashboard with `pnpm test:ui`; coverage with
`pnpm test:coverage` (opt-in — runs `vitest run --coverage`).

Shared helpers (`_helpers.ts`, `test-constants.ts`) live alongside
the test files but do **not** match the `*.test.ts` include glob
(`_helpers.ts` starts with `_`, `test-constants.ts` has no
`.test.` suffix) so Vitest never tries to execute them.

Each test file is a self-contained scenario:
- **`scripts/smoke.test.ts`** — instantiates both adapters, fetches
  USDC/WETH 0.05% on Ethereum mainnet via Uniswap V3, and probes
  Sonic RPC reachability for Shadow. Live reads may fail (public
  RPCs are unreliable) — the test tolerates transport-level
  failures and asserts only the wire-up shape.
- **`domains/pool/pool.test.ts`** — Phase 3 domain stack
  end-to-end against Ethereum mainnet USDC/WETH 0.05%: builds a
  `Pool`/`Market` aggregate from live state, runs the
  `ConstantRangeGenerator` to produce three candidate ranges, runs
  the `AnalyticsEngine` and `DepositSimulation` for each, and
  proves `PoolHistory.priceMove()` is well-defined.
- **`math/math-engine.test.ts`** — Phase 4 math engine
  end-to-end. Builds a synthetic 8-day daily price history anchored
  on the live USDC/WETH 0.05% pool state, then computes realized
  volatility, IL, capital efficiency, both range generators, APR,
  and a Sharpe-like score.
- **`domains/simulation/simulation.test.ts`** — Phase 5 simulation
  engine. Wires `DepositSimulation` (level 1),
  `FuturePriceSimulation` (level 2 — scenarios at unchanged, −10%,
  +10%), `HistoricalReplaySimulation` (level 3 — round-trip APR
  matches the 30% target within 5% tolerance), and
  `MonteCarloSimulation` (level 4 — 200 paths × 30 daily steps,
  GBM with `σ_annual` from the live-anchored vol estimate). If the
  live RPC read fails it falls back to a synthetic pool fixture so
  the test always completes.
- **`domains/recommendation/recommendation.test.ts`** — Phase 6
  recommendation engine. Builds five strategies
  (`BalancedStrategy`, `MaximumFeeStrategy`, `LowestRiskStrategy`,
  `HighestCapitalEfficiencyStrategy`, `HighestSharpeStrategy`) on a
  USDC/WETH 0.05% pool, derives `σ_annual` from a synthetic 30-day
  history, runs the engine against a 5-candidate sweep, and
  re-runs with a 0.5× weight on `lowest-risk` to verify the
  `applyWeight` math end-to-end. Confirms the LowestRisk
  strategy's top CE is ≤ MaximumFee's top CE (orthogonal biases),
  and that the engine is deterministic across re-runs.
- **`application/use_cases/use_cases.test.ts`** — Phase 7
  application layer. Wires `NetworkRegistry` →
  `NetworkProvider` → `createCoreServices(...)` → `useCases()` and
  runs every one of the five use cases (`discoverPools`,
  `analyzePool`, `simulatePosition`, `replayHistoricalPerformance`,
  `compareStrategies`) against live Ethereum mainnet USDC/WETH
  0.05%, falling back to a synthetic pool if the public RPC is
  down. Sanity-asserts every DTO shape, the IRpcProvider `blockTag`
  extension (reading the WETH symbol at a pinned block via
  `services.rpc().readContract({ ..., blockTag })`), and the
  negative paths: `InvalidUseCaseInputError` (bad inputs /
  bad ranges), `MissingPoolHistoryError` (replay without history),
  and `AdapterNotFoundError` (unregistered chain). The custom
  mainnet `TNetwork` overrides `rpcUrls` to publicnode and sets
  `multicall3Address` because the bundled `ethereum` constant uses
  llamarpc (frequently 521).
- **`application/use_cases/get_pool_history.test.ts`** — Phase 10
  `GetPoolHistoryUseCase` and the `IProtocolAdapter
  .getPoolStateAtBlock` extension. Three tests: live USDC/WETH
  0.05% (on-chain or synthetic, ≥ 2 snapshots), direct
  `getPoolStateAtBlock` adapter call returning a non-zero tick at
  a historical block, and WETH/USDT 0.3% (volatile pool to confirm
  the volatility path doesn't divide by zero on organic movement).

See §11 for the testing rules (no Playwright, location, Vitest
idioms, commands).

### 6.9 Phase 3 — Core Domain (done)
Phase 3 builds the **protocol-independent business model** on top of
the adapter types from §6.6. All modules in this section consume only
`shared/**`, `math/**`, and the protocol-neutral `T*` shapes in
`adapters/types/`. They MUST NOT import from `adapters/`,
`providers/`, `nuxt`, `vue`, `viem`, or any SDK.

- `app/core/shared/value_objects/`
  - `price.value-object.ts` → `Price` — immutable fixed-point price (bigint
    scaled to `decimals`). Constructor validates the decimals argument.
  - `tick_range.value-object.ts` → `TickRange` — validates the V3 envelope
    (`±887272`) and `tickLower < tickUpper`.
  - `pool_state.value-object.ts` → `PoolStateVO` — wraps a `TPoolState`,
    exposes `currentPrice(decimals=18)` via the local
    `sqrtPriceX96ToPrice(...)` helper.
  - `index.ts` — barrel.
- `app/core/shared/utils/`
  - `format_amount.util.ts` → `formatAmount(value, decimals)` and
    `formatAmountShort(value, decimals, fractionDigits)`.
  - `index.ts` — barrel.
- `app/core/math/`
  - `tick_math.util.ts` → `MIN_TICK` / `MAX_TICK` constants,
    `sqrtRatioAtTick(tick)` (Q64.96), and `tickToPrice(tick,
    token0Decimals, token1Decimals, decimals=18)` — see §5.7a for the
    bigint-shift caveat.
  - `index.ts` — barrel.
- `app/core/domains/pool/`
  - `pool.class.ts` → `Pool` aggregate (state + tick map + chainId)
    with `currentPrice(decimals)`, `formatAmount(amount, which)`,
    `priceAtTick(tick, decimals)`, `makeRange(...)`, and
    `withTicks(...)` for fold-in.
  - `pool_tick_map.value-object.ts` → `PoolTickMap` — sparse map with
    `at(idx)`, `indices()`, `toArray()`, `inRange(...)`, `merge(...)`.
  - `create_pool.factory.ts` → `createPool({ state, chainId, ticks? })`.
  - `index.ts` — barrel.
- `app/core/domains/position/`
  - `position.class.ts` → `Position` immutable aggregate
    (`range`, `liquidity`, `amount0`, `amount1`, `token0`, `token1`).
    Exposes `Position.fromQuote(pool, TQuotePosition)` and
    `Position.fromRaw(...)` to translate from adapter types.
  - `create_position.factory.ts` → `createPosition({ pool, ... })`.
  - `index.ts` — barrel.
- `app/core/domains/market/`
  - `market.class.ts` → `Market` thin wrapper over `Pool` exposing
    `currentPrice()`, `currentTick`, `feeTier`, `describe()`.
  - `create_market.factory.ts` → `createMarket({ pool, chainId, displayDecimals? })`.
  - `index.ts` — barrel.
- `app/core/domains/history/`
  - `pool_snapshot.value-object.ts` → `PoolSnapshot` — point-in-time
    snapshot (block, timestamp, state, derived Price).
  - `pool_history.class.ts` → `PoolHistory` — append-only log of
    `PoolSnapshot`s with `inBlockRange(...)`, `latest()`, `earliest()`,
    `priceMove()`.
  - `create_pool_history.factory.ts` → `createPoolHistory({ pool, chainId, snapshots? })`.
  - `index.ts` — barrel.
- `app/core/domains/analytics/`
  - `analytics_engine.class.ts` → `AnalyticsEngine` — pure derived
    metrics: `rangePrices(pool, range, decimals)`,
    `positionSide(pool, position)`, `totalDeposit(position, pool)`,
    `historyReturn(history)`.
  - `create_analytics_engine.factory.ts` → `createAnalyticsEngine()`.
  - `index.ts` — barrel.
- `app/core/domains/recommendation/`
  - `range_generator.interface.ts` → `IRangeGenerator` — behavior
    contract: `generate(pool) → readonly TickRange[]`.
  - `constant_range_generator.class.ts` → `ConstantRangeGenerator` —
    symmetric ±N×tickSpacing ranges around current tick, clamped to V3
    envelope. Constructor validates widths.
  - `create_constant_range_generator.factory.ts` → `createConstantRangeGenerator(...)`.
  - `index.ts` — barrel.
- `app/core/domains/simulation/`
  - `simulation.interface.ts` → `ISimulation<TInput, TOutput>` —
    behavior contract: `run(input, pool, position) → output` (pure).
  - `deposit_simulation.class.ts` → `DepositSimulation` — level-1
    deposit simulation: in-range check + fill ratio (token0 consumed
    / token0 requested) at 18-dec scale. Refined in Phase 5 to also
    emit `lowerPrice` / `upperPrice` / `decimals` for chart rendering.
  - `future_price_simulation.class.ts` → `FuturePriceSimulation` —
    level-2 (Phase 5). Deterministic "what if price moves to X"
    scenarios; emits IL + side + terminal value + 1y-APR projection.
  - `historical_replay_simulation.class.ts` → `HistoricalReplaySimulation` —
    level-3 (Phase 5). Walks a `PoolHistory` snapshot-by-snapshot
    (history supplied at construction time so the
    `run(input, pool, position)` signature stays stable) and
    accumulates IL + fees + APR + time-in-range.
  - `monte_carlo_simulation.class.ts` → `MonteCarloSimulation` —
    level-4 (Phase 5). Geometric Brownian Motion per path with a
    deterministic LCG PRNG + CLT normal approximation.
  - `create_*_simulation.factory.ts` — one factory per simulation
    level (`createDepositSimulation`, `createFuturePriceSimulation`,
    `createHistoricalReplaySimulation`, `createMonteCarloSimulation`).
  - `index.ts` — barrel updated to re-export all four levels
    (and `IHistoricalReplaySimulationOptions`,
    `IMonteCarloSimulationInput`, etc.).
- `app/core/domains/strategy/`
  - `strategy.interface.ts` → `IRecommendationStrategy` — behavior
    contract `score(pool, position) → bigint` at `[0, SCORE_SCALE]`,
    `0n` to mean "skip".
  - `index.ts` — barrel.
- `app/core/domains/recommendation/`
  - `range_generator.interface.ts` → `IRangeGenerator` —
    `generate(pool) → readonly TickRange[]`. Phase 3 ships two
    implementations:
  - `constant_range_generator.class.ts` →
    `ConstantRangeGenerator({ widthsTicks })` — symmetric ±N×tickSpacing
    ranges around the current tick, tick-aligned, V3-envelope-clamped.
  - `volatility_adjusted_range_generator.class.ts` →
    `VolatilityAdjustedRangeGenerator({ dailySigmaTicks,
    sigmaMultipliers, tickSpacingOverride? })` — same shape but
    half-widths are `dailySigmaTicks × σ-multiplier`.
  - `recommendation.value-object.ts` → `Recommendation` +
    `IRecommendationFields`. Immutable value object carrying per-
    strategy scoring details (see §6.13 for the full shape).
  - `recommendation_set.value-object.ts` → `RecommendationSet` —
    immutable ranked list + context. Helpers: `top()`,
    `byStrategy(id)`, `topForStrategy(id)`, `withMinScore(...)`.
  - `scoring_config.value-object.ts` → `ScoringConfig` +
    `IScoringConfigFields` + `defaultScoringConfig()` +
    `createScoringConfig(...)`. Per-strategy weight multipliers +
    global `riskFreeApr` / `targetApr` / `realizedVolatilityAnnual`
    / `minCapitalEfficiency` / `minScoreToKeep`. The
    `applyWeight(strategyId, rawScore)` method clamps at
    `[0, SCORE_SCALE]` so the documented score invariant holds.
  - **Phase 6 strategies** (one file each, plus a matching
    `create_*_strategy.factory.ts`): `BalancedStrategy`,
    `MaximumFeeStrategy`, `LowestRiskStrategy`,
    `HighestCapitalEfficiencyStrategy`, `HighestSharpeStrategy`.
    See §6.13 for the exact scoring formulas and ceiling choices.
  - `recommendation_engine.class.ts` → `RecommendationEngine` +
    `IRecommendInput`. Orchestrator:
    `recommend({ pool, generator, strategies, scoringConfig, ... })`
    → `RecommendationSet`. Pipeline described in §6.13.
  - `create_recommendation_engine.factory.ts` →
    `createRecommendationEngine()`.
  - `index.ts` — barrel updated to re-export every public symbol
    above.
- `app/core/domains/index.ts` — top-level barrel for the domain
  layer, re-exporting all of the above.

**Allowed imports inside a domain module** (under §3 dependency rules):
  - `@core/shared` (types, value objects, utils, errors)
  - `@core/math`
  - `@core/adapters/types` (the `T*` shapes that came from a pool adapter)
  - peer domain modules (e.g. `pool` may import `position`)

**Forbidden** at this layer: `adapters/**` (the runtime classes), `providers/**`, `nuxt`, `vue`, `viem`, any external SDK. If a domain needs an RPC-fetched value, that fetch must already have happened at the adapter layer.

### 6.10 `app/pages/`, `app/components/`, `app/plugins/`, `app/layouts/`, `app/utils/`
Shipped in Phase 8. See §6.15 for the Phase 8 inventory and §6.16
for the Phase 9 additions. Filenames in this layer follow the
Nuxt 4 conventions in §4.10. Future additions:
- `app/components/` was empty in Phase 8; Phase 9 split the
  pool-detail tabs into `DiscoverForm.vue`, `PoolHeader.vue`,
  `PoolDetailsTab.vue`, `RecommendationTab.vue`,
  `SimulationTab.vue`, `StrategiesTab.vue` (PascalCase `*.vue`,
  auto-registered by Nuxt). Phase 9 slice 4 also added
  `RpcSettings.vue` (the per-chain custom-RPC form that
  powers `useRpcOverride`). Phase 9 slice 5 added
  `TokenSelect.vue` (the icon + symbol dropdown used for
  Token A / Token B in the Discover form).
- `app/utils/` currently only has `formatDtos.ts`. Phase 9+
  will add chart helpers and bigint→DOM helpers. `formatDtos.ts`
  also re-exports a few pure helpers from `@core/shared/utils`
  (currently `formatAmountShort`) so they pick up Nuxt's
  standard `app/utils/` auto-import scan.

### 6.11 Phase 4 — Mathematical Engine (done)
Phase 4 ships the math engine on top of the math tick scaffold from
§6.9. All modules in this section consume only `shared/**` and are
**strictly pure** — no on-chain reads, no I/O. The math layer sits
below `domains/` per the §3 dependency rules.

- `app/core/math/il.util.ts` → `IL_SCALE = 1e18`, `bigintSqrtFloor(x)`,
  `ilFromPriceRatio(priceRatio, decimals=18)`, and
  `ilBetweenPrices(newPrice, newDecimals, oldPrice, oldDecimals,
  outDecimals=18)`. The IL formula is the V2-style `2√p/(1+p) − 1`
  applied to the price ratio `p = newPrice / oldPrice`. Output sign
  convention: IL < 0 means a *loss* vs HODL (e.g. a 4× price move
  yields IL = -0.20 = -20%).
- `app/core/math/capital_efficiency.util.ts` →
  `CAPITAL_EFFICIENCY_SCALE = 1e18`, `capitalEfficiencyRatio(lo, hi)`,
  and `capitalEfficiencyVsFullRange(lo, hi)`. The first form is
  `P_upper / P_lower` (the "concentration multiplier" used in DeFi
  UIs); the second is the tick-space form for sanity-checking.
- `app/core/math/volatility.util.ts` → `VOLATILITY_SCALE = 1e18`,
  `SECONDS_PER_YEAR = 31_557_600`, `realizedVolatility(observations,
  secondsPerYear?)`, `realizedVolatilityFromPrices(prices,
  timestamps, secondsPerYear?)`, plus `IPriceObservation` and
  `IVolatilityResult` types. Sample-variance log-return stdev,
  annualized via `√(spy / meanΔt)`. Internal `bigintLn(...)` uses
  range reduction + 6-term Taylor series; ~1e-4 relative accuracy.
- `app/core/math/apr.util.ts` → `APR_SCALE = 1e18`,
  `aprFromFees(feesRaw, principalRaw, windowSeconds, secondsPerYear?)`,
  `combinedApr(fees0Num, fees1Num, principalNum, windowSeconds, ...)`,
  and `aprFromRawTwoLeg(fees0, fees1, principal0, principal1,
  token0PriceScaled, token1PriceScaled, priceDecimals, t0Dec, t1Dec,
  numeraireDecimals, windowSeconds, ...)`. All returns scale at
  1e18 == 100% APR.
- `app/core/math/scoring.util.ts` → `SCORE_SCALE = 1e18`,
  `sharpeLikeScore(expectedApr, volatility, riskFreeApr=0)` and
  `sharpeFromWindow(fees, principal, windowSeconds, volAnnual,
  riskFreeApr=0, ...)`.
- `app/core/math/index.ts` — barrel exporting every public symbol
  above plus the tick-math helpers from Phase 3.

Phase 4 also extends two existing domain modules:

- `app/core/domains/analytics/analytics_engine.class.ts` now ships
  `ilAtCurrentPrice(pool, entryPrice)`, `capitalEfficiency(range)`,
  `volatility(observations)`, `volatilityFromHistory(history)`,
  `apr(fees, principal, window)`, `score(expectedApr, volatility,
  riskFreeApr)`, `scoreFromWindow(...)`, and a convenience
  `positionMetrics(pool, position, entryPrice)` bundle.
  All five scale constants are re-exported from this class.
- `app/core/domains/recommendation/`
  - `volatility_adjusted_range_generator.class.ts` →
    `VolatilityAdjustedRangeGenerator` — symmetric ranges around the
    current tick whose half-widths are `dailySigmaTicks × σ-multiplier`.
    Output is tick-spacing-aligned, clamped to ±887272.
  - `create_volatility_adjusted_range_generator.factory.ts` →
    `createVolatilityAdjustedRangeGenerator({ dailySigmaTicks,
    sigmaMultipliers, tickSpacingOverride? })`.
  - `index.ts` — barrel updated.

Test: `app/core/test/math/math-engine.test.ts` (run via
`pnpm test app/core/test/math/math-engine.test.ts`) exercises
every Phase 4 metric end-to-end. It builds a synthetic 8-day
daily price history anchored on the live USDC/WETH 0.05% pool
state (free RPCs without archive tokens don't permit historical
`eth_call`), then computes:

- realized vol per-period and annualized,
- IL at current price vs the earliest snapshot,
- CE for three ±N×spacing ranges,
- candidate ranges from both `ConstantRangeGenerator` and
  `VolatilityAdjustedRangeGenerator`,
- APR + Sharpe-like score from a synthetic 7-day fee window,
- a `positionMetrics(...)` bundle for one quoted position.

Known caveats:

- Public Ethereum RPCs (e.g. `ethereum-rpc.publicnode.com`) require
  archive tokens for historical `eth_call`. The Phase 4 smoke therefore
  builds a deterministic synthetic history rather than reading past
  on-chain state. Phase 7 (use cases) is expected to extend the
  adapter's `IRpcProvider` interface with a `blockTag` parameter for
  real historical reads.
- The IL formula is the V2 / `x*y=k` form. For a CL position that
  exits the range, realized IL is *worse* than this scalar; callers
  should combine it with `positionSide(...)` for the full picture.

### 6.12 Phase 5 — Simulation Engine (done)
Phase 5 ships the four-level simulation framework described in
README §"Phase 5":

1. **Deposit** (level 1, already in Phase 3, refined in Phase 5).
2. **Future price** (level 2).
3. **Historical replay** (level 3).
4. **Monte Carlo** (level 4).

All simulations implement the
{@link ISimulation}`<TInput, TOutput>` interface
(`run(input, pool, position) → output`). They are **pure** — no IO,
no on-chain reads. New modules:

- `app/core/math/lnexp.util.ts` →
  `bigintExp(value, decimals)`, `bigintExpRescaled(...)`,
  `EXP_LN_SCALE = 1e18`, `LN2_AT_LN_SCALE`. Companion to the
  private `bigintLn` inside `volatility.util.ts`. Uses range
  reduction (`exp(x) = exp(x/2^k)^(2^k)`) + 6-term Taylor for
  ~1e-4 relative accuracy on `|x| < 64`. Used by Monte Carlo and
  by the Phase 4/5 smoke scripts that anchor synthetic histories
  on live state via cumulative-log-return re-centering.

- `app/core/domains/simulation/deposit_simulation.class.ts` (refined)
  → `DepositSimulation` (level 1). Output now also carries the
  position's `lowerPrice` / `upperPrice` (at 18-dec) for chart
  rendering. The existing `currentlyInRange`, `side`, `liquidity`,
  `amount0`, `amount1`, `fillRatio` fields are preserved.

- `app/core/domains/simulation/future_price_simulation.class.ts` →
  `FuturePriceSimulation` (level 2). Input:
  `{ entryPrice, futurePrice, numeraireToken, principalInNumeraire }`.
  Output: `{ side, inRange, il, terminalValueInNumeraire,
  pnlInNumeraire, totalReturn, apr1y, capitalEfficiency }`. Uses the
  V2 / x·y=k approximation for terminal value (`TV_token0 =
  amount0 + amount1 / p`), so it doesn't account for full CL
  exit behaviour — combine with `side` for the full picture.

- `app/core/domains/simulation/historical_replay_simulation.class.ts` →
  `HistoricalReplaySimulation` (level 3). Takes a `PoolHistory` at
  construction time (so the `ISimulation.run(input, pool,
  position)` signature stays stable across all four levels). Walks
  the snapshots chronologically, accruing per-interval fees as
  `fees_per_step = principal × feeRatePerSecond × dt / 1e18`,
  where `feeRatePerSecond` is the per-second fee expressed as a
  *fraction* of principal at 1e18 precision (caller pre-computes
  it as `apr_fraction_1e18 / SECONDS_PER_YEAR`). Output is rich:
  per-step `samples[]` plus aggregates (`totalFees`, `apr`,
  `meanIl`, `min/max/finalIl`, `timeInRangeFraction`,
  `maxDrawdown`, `totalSeconds`, `nIntervals`, `nSnapshots`).

- `app/core/domains/simulation/monte_carlo_simulation.class.ts` →
  `MonteCarloSimulation` (level 4). Geometric Brownian Motion per
  path with a CLT-approximated normal deviate (12-uniform → ~N(0,1);
  ≈ 1% tail error beyond ±3σ, sufficient at 1e18 precision). PRNG
  is deterministic LCG so the same `seed` always yields the same
  paths. Output: `summary` (mean / p5 / p50 / p95 of final IL, APR,
  terminal value; mean time-in-range; probability of ending
  in-range) plus per-path `paths[]` with `samples[]` for charting.

- `app/core/domains/simulation/create_*_simulation.factory.ts` →
  `createDepositSimulation`, `createFuturePriceSimulation`,
  `createHistoricalReplaySimulation`, `createMonteCarloSimulation`.

- `app/core/domains/simulation/index.ts` — barrel updated to
  re-export all four simulation levels.

Test: `app/core/test/domains/simulation/simulation.test.ts` (run
via `pnpm test app/core/test/domains/simulation/simulation.test.ts`)
exercises all four simulation levels end-to-end. It wires a live
USDC/WETH 0.05% pool (or a synthetic fallback if the RPC fails),
re-quotes a 100 USDC position, and reports:

- FuturePriceSimulation across three scenarios — IL matches the V2
  formula exactly (`-0.14%` for a −10% price move, `-2.02%` for
  +50%).
- HistoricalReplaySimulation on a synthetic 30-day daily history
  with a 30% target APR — `apr = 30.00%` exactly (round-trip
  works because the simulation uses the same APR convention as
  `app/core/math/apr.util.ts`).
- MonteCarloSimulation with `σ_annual` derived from the synthetic
  history (around 80% for a 3% daily-σ synthetic), 200 paths × 30
  daily steps — quantiles (`p5/p50/p95 IL`, `p5/p50/p95 APR`) and
  `probInRange` ordering is consistent across all paths.

The 8 sanity assertions at the end of the smoke (IL ≈ 0 at
unchanged price, TV > 0, fees > 0 for in-range intervals,
`timeInRange ∈ [0,1]`, MC quantile ordering, MC `probInRange` in
range, and `AnalyticsEngine.scoreFromWindow ≥ 0`) all pass.

Bugfix folded into Phase 5:

- **`sqrtPriceX96ToPrice` had an inverted decimal delta.** The
  original formula used `targetScale = decimals + (token1Dec -
  token0Dec)`, but the correct derivation (since
  `price_raw = token1_raw / token0_raw` and we want
  `value / 10^decimals == price_human`) is
  `targetScale = decimals + (token0Dec - token1Dec)`. The bug
  surfaced in Phase 5's terminal-value math because it needs the
  *absolute* price in human units (Phase 4 only used price *ratios*
  — IL, vol, APR — and was unaffected). `tickToPrice` had the same
  bug and was fixed in lockstep.

Known caveats:

- `HistoricalReplaySimulation` requires `feeRatePerSecond` at 1e18
  precision in units of "fraction of principal per second". Callers
  pre-compute as `apr_fraction_1e18 / SECONDS_PER_YEAR`. This
  avoids the truncation-to-zero trap for small-raw numeraire
  tokens (e.g. 6-dec USDC at < 1 raw fee/second). The smoke shows
  the round-trip (`apr = 30%` from a target of 30%) working
  end-to-end.
- `FuturePriceSimulation`'s terminal-value math is the V2
  approximation. For a CL position that exits the range, the
  realised exit value is *worse* than this scalar. Phase 6/7 will
  layer on the CL-exit correction.
- `MonteCarloSimulation` uses a CLT normal approximation (sum of
  12 uniforms, subtract 6). For tail quantiles (p1/p99) the
  approximation is rough; use a proper Box-Muller transform in a
  later phase if needed.
- The Monte Carlo `probInRange = 0%` in the smoke output reflects
  the test scenario: a narrow ±500×tickSpacing range combined with
  the synthetic 30-day history's 80%-annualised vol means almost
  every path immediately exits. The metric is well-defined; just
  unhelpful in this particular fixture.

### 6.13 Phase 6 — Recommendation Engine (done)
Phase 6 ships the recommendation engine described in README §"Phase 6":
candidate generation → strategy scoring → weighted ranking. New
modules:

- `app/core/domains/recommendation/recommendation.value-object.ts` →
  `Recommendation` value object + `IRecommendationFields` shape. Each
  carries `{ id, strategyId, strategyName, range, score,
  expectedApr, feeRatePerSecond, ilAtCurrentPrice,
  capitalEfficiency, riskEstimate, currentlyInRange, side }`. Score
  is at `SCORE_SCALE` (1e18 == 1.0); APR at `APR_SCALE`; IL at
  `IL_SCALE`; CE at `CAPITAL_EFFICIENCY_SCALE`. The constructor
  validates non-negative scores + positive CE.

- `app/core/domains/recommendation/recommendation_set.value-object.ts` →
  `RecommendationSet` — an immutable, ranked list of
  `Recommendation`s plus a `context` blob (`pool`, `chainId`,
  `strategyIds`, `poolDescription`, `rangeGeneratorId`,
  `nCandidates`, `nRecommendations`, `nSkipped`). Helpers:
  `top()`, `byStrategy(id)`, `topForStrategy(id)`, `withMinScore(...)`.

- `app/core/domains/recommendation/scoring_config.value-object.ts` →
  `ScoringConfig` + `IScoringConfigFields` + `defaultScoringConfig()` +
  `createScoringConfig(...)`. Knobs: per-strategy `weights`, global
  `riskFreeApr`, `targetApr`, `realizedVolatilityAnnual`,
  `minCapitalEfficiency`, `minScoreToKeep`. The
  `applyWeight(strategyId, rawScore)` method multiplies a strategy's
  raw score by its weight (both at `SCORE_SCALE` precision) and
  **clamps** to `[0, SCORE_SCALE]` so the documented invariant on
  `IRecommendationFields.score` is preserved even with sub-1× or
  > 1× weights.

- `app/core/domains/recommendation/balanced_strategy.class.ts` →
  `BalancedStrategy` (`id = 'balanced'`). Multiplicative blend
  `score = aprFactor × ceFactor × ilFactor`, where `aprFactor` and
  `ceFactor` saturate at 1.0 once APR ≥ 100%/yr or CE ≥ 5×,
  and `ilFactor = 1 + il`. Drives the "default sensible LP" UI.

- `app/core/domains/recommendation/maximum_fee_strategy.class.ts` →
  `MaximumFeeStrategy` (`id = 'maximum-fee'`). Geometric mean
  `score = √(aprFactor × ceFactor)`. Saturates at APR=200%/yr and
  CE=5×. The "aggressive" choice for the UI's
  aggressive-vs-defensive split.

- `app/core/domains/recommendation/lowest_risk_strategy.class.ts` →
  `LowestRiskStrategy` (`id = 'lowest-risk'`). Composite
  `(1 − ceFactor) × (1 + il)` — wider ranges (low CE) and lower IL
  score higher. The "defensive" choice. (Note: in CL the trade-off
  is *lower* CE ⇒ *less* IL risk ⇒ wider range ⇒ safer; the
  strategy prefers narrow-CE candidates because narrow CE =
  "V2-like" risk profile.)

- `app/core/domains/recommendation/highest_capital_efficiency_strategy.class.ts` →
  `HighestCapitalEfficiencyStrategy` (`id =
  'highest-capital-efficiency'`). Pure-CE ranker;
  `score = min(ce, MAX_CE) / MAX_CE`. Useful as a sanity check
  and as the "I want the tightest range, period" choice.

- `app/core/domains/recommendation/highest_sharpe_strategy.class.ts` →
  `HighestSharpeStrategy` (`id = 'highest-sharpe'`). Computes
  `(expectedApr − riskFreeApr) / annualizedVol`, normalizes against
  a soft ceiling of `2.0` Sharpe. Static factory
  `HighestSharpeStrategy.fromFeesWindow(fees, principal, window,
  volAnnual)` for callers that have a fees/principal/window triple
  (matches `HistoricalReplaySimulation`'s convention).

- `app/core/domains/recommendation/recommendation_engine.class.ts` →
  `RecommendationEngine` + `IRecommendInput`. Orchestrator:
  `recommend({ pool, generator, strategies, scoringConfig, ... })`
  → `RecommendationSet`. Pipeline:
  `candidates = generator.generate(pool)` →
  `for each candidate × strategy: strategy.score(pool, stub) →
  scoringConfig.applyWeight → Recommendation` →
  `sort by score desc, tie-break by CE desc, then id asc` →
  `RecommendationSet`. Position is currently a zero-amount stub
  (`liquidity = amount0 = amount1 = 0n`) — Phase 7+ wires
  `adapter.quotePosition(...)`.

- Five new `create_*_strategy.factory.ts` files:
  `createBalancedStrategy`, `createMaximumFeeStrategy`,
  `createLowestRiskStrategy`,
  `createHighestCapitalEfficiencyStrategy`,
  `createHighestSharpeStrategy`.

- `app/core/domains/recommendation/create_recommendation_engine.factory.ts` →
  `createRecommendationEngine()`.

- `app/core/domains/recommendation/index.ts` — barrel updated to
  re-export all of the above.

Test: `app/core/test/domains/recommendation/recommendation.test.ts`
(run via `pnpm test
app/core/test/domains/recommendation/recommendation.test.ts`)
exercises the engine end-to-end against the live USDC/WETH 0.05%
pool (or a synthetic fallback). It builds a synthetic 30-day daily
history, derives `σ_annual ≈ 51%`, and feeds all five strategies
with `expectedApr = 30%`. The ConstantRangeGenerator produces
five candidates (widths 100/500/2000/10000/50000 ticks at 10-tick
spacing). The sanity assertions cover:

- engine produces ≥1 recommendation,
- ranking is monotonic by score,
- all five strategy IDs are represented,
- HighestSharpeStrategy scored every candidate (positive Sharpe
  for all — the dead-code CE-floor check was removed since
  CE < 1× is unreachable for valid ranges),
- LowestRisk top CE ≤ MaximumFee top CE (the strategies'
  biases are orthogonal),
- a 0.5× weight on `lowest-risk` halves the score of the
  top-1 lowest-risk entry (verifying `applyWeight` math),
- the engine is deterministic across re-runs,
- every recommendation has CE > 0,
- at least one recommendation has `expectedApr > 0`.

Known caveats:

- **Phase 6 strategies use static APR priors**, not per-candidate
  replays. The engine scores `BalancedStrategy` /
  `MaximumFeeStrategy` / `HighestSharpeStrategy` against a
  *single* `expectedApr` value supplied at construction time; it
  does **not** re-run a `HistoricalReplaySimulation` for every
  candidate to derive a per-candidate APR. That loop (and
  per-candidate `quotePosition` re-quoting) belongs in Phase 7
  where the engine lives inside an application-layer use case.
- **Phase 6 strategies score against the *current* pool price**.
  `ilAtCurrentPrice` is the V2 IL applied to the
  current-vs-entry price ratio — a CL position that exits its
  range between now and the entry will realise *worse* IL than
  this scalar. Phase 7 use cases can layer on the
  `FuturePriceSimulation`'s worst-case branch.
- **Position amounts are zeroed out.** The engine passes a stub
  `Position` with `liquidity = amount0 = amount1 = 0n` to each
  strategy. Strategies that need `amount0` / `amount1` / `liquidity`
  (none ship in Phase 6) cannot work yet. Phase 7 will replace
  the stub with a real `adapter.quotePosition(...)` call.
- **The 0.5× weight test passes only because the strategies leave
  headroom.** `HighestCapitalEfficiencyStrategy` and
  `HighestSharpeStrategy` saturate to 1.0 for very wide / very low-
  vol candidates, so a > 1× weight on them is a no-op (the
  `applyWeight` clamp caps at `SCORE_SCALE`). Callers wanting
  strict weight-induced dominance should lower the strategy's
  internal `MAX_*` ceilings.
- **`BalancedStrategy` zeroing for low-CE candidates.** With the
  default `riskFreeApr = 0n` and the test's `expectedApr = 30%`,
  the strategy emits score `0` whenever the IL factor would push
  the product to zero — that's the documented "I have a great APR
  but my IL is terrible" gate. The smoke shows 3 candidates dropped
  out of 5×5 = 25 slots; this is the expected behaviour.

---

### 6.14 Phase 7 — Application Layer (done)
Phase 7 is the **use-case orchestration layer** sitting on top of
the Phase 6 recommendation engine. Everything in this section may
import from `shared/**`, `math/**`, `domains/**`, `adapters/**`,
`providers/**`, `network/**`, and `application/**` itself. It MUST
NOT import from `vue`, `nuxt`, or `@composables/` (Phase 8).

The Phase 7 surface is intentionally a thin façade:

- **Errors** (`app/core/application/errors/`) — every error class
  extends a shared abstract `UseCaseError` carrying a stable
  `code` string for pattern-matching without `instanceof`. Three
  concrete errors ship today:
  - `InvalidUseCaseInputError` (`code = 'invalid-input'`) —
    thrown when `useCase.execute()` is called with a malformed
    field (missing pool, range where `tickLower >= tickUpper`,
    negative principal, unhandled `chainId`). Carries `useCase +
    field + message` so the UI can highlight the offending input.
  - `MissingPoolHistoryError` (`code = 'missing-pool-history'`) —
    thrown by `ReplayHistoricalPerformanceUseCase` when the
    caller forgot the history. Carries `useCase + pool + chainId`.
  - `AdapterNotFoundError` (`code = 'adapter-not-found'`) —
    thrown by `CoreServices.resolveAdapter` (and thus transitively
    by every use case that asks for an adapter) when no adapter
    is registered for `chainId`/`protocolId`. Carries `useCase +
    chainId + protocolId?`.

- **DTOs** (`app/core/application/dtos/`) — protocol-neutral,
  UI-ready plain objects + bigints. The five DTOs:
  - `IPoolAnalysisDTO` — single-pool summary. `currentPrice` at
    `currentPriceDecimals`; `cumulativeReturn = latestPrice /
    earliestPrice` at `returnDecimals = 18`; `annualizedVolatility`
    defaults to `0n` when no history was supplied. Carries
    `token0` / `token1` minimal summaries (address + symbol +
    decimals).
  - `IPositionSimulationDTO` — bundles `quote + deposit +
    futurePrice + historical + monteCarlo` for one position at one
    entry price. Optional slots are `null` (not `undefined`) when
    the caller didn't ask for that level. `futurePrice.horizonSeconds
    = SECONDS_PER_YEAR` is a stable convenience field — the
    `FuturePriceSimulation` is a *single-shot* price move and
    doesn't carry an explicit horizon by design.
  - `IHistoricalReplayDTO` — flat shape of a historical-replay
    result with the input knobs (`entryPrice`, `principalIn
    Numeraire`, `numeraireToken`, `feeRatePerSecond`) echoed
    back so the UI can render the replay context.
  - `IRecommendationDTO` + `IRecommendationEntryDTO` — wraps
    `RecommendationSet` and flattens each `Recommendation`
    value-object to a plain-object row with `tickLower` /
    `tickUpper` at the top level (no `range` nesting) so the UI
    can render a flat table directly.
  - All DTOs use plain `bigint` (no Core value objects),
    readonly fields, and stable field names — designed for
    `JSON.stringify` round-trips for SSR or Nuxt payload
    serialization.

- **Use cases** (`app/core/application/use_cases/`) — five
  orchestrators, each in a `*.use_case.ts`:
  - `DiscoverPoolsUseCase` — two modes: curated
    `discoverPools()` against the registered adapter, and
    `lookupPool(tokenA, tokenB, fee)` via duck-typed
    `adapter.resolvePool(...)`. Lookup mode echoes `tokenA` /
    `tokenB` back as `IDiscoveredTokenDTO {address, symbol,
    decimals}` with symbol/decimals defaulting to empty/0
    (the caller can enrich via a follow-up `AnalyzePool`).
  - `AnalyzePoolUseCase` — fetches pool state via the resolved
    adapter, builds the `Pool` aggregate, and (when `history`
    is supplied with ≥ 2 snapshots) derives `annualizedVolatility`
    via `AnalyticsEngine.volatilityFromHistory(history)` plus
    `cumulativeReturn` via `last.price.ratio(first.price, 18).value`.
  - `SimulatePositionUseCase` — quotes the position via
    `adapter.quotePosition(...)`, then runs the requested sim
    levels in one call: `DepositSimulation` (always) +
    `FuturePriceSimulation` (when `futurePrice` provided) +
    `HistoricalReplaySimulation` (when `history` provided, with
    `feeRatePerSecond` derived as `targetApr / SECONDS_PER_YEAR`
    when not explicit) + `MonteCarloSimulation` (when
    `monteCarlo` provided with μ/σ/paths/steps). Each optional
    slot is `null` when not requested.
  - `ReplayHistoricalPerformanceUseCase` — *offline-capable*
    (does not call any adapter). Throws
    `MissingPoolHistoryError` if `history` has < 2 snapshots.
    Builds a stub `Position` with zero amounts and a stub `Pool`
    built from the earliest snapshot's tick (the historical
    sim only consumes `position.range` and `pool.state.tick`
    for in-range checks). `entryPrice` defaults to the earliest
    snapshot's price.
  - `CompareStrategiesUseCase` — wraps the Phase 6
    `RecommendationEngine` with sensible defaults: 5 strategies
    (`Balanced`, `MaximumFee`, `LowestRisk`,
    `HighestCapitalEfficiency`, `HighestSharpe`) and 5 widths
    `[100, 500, 2000, 10000, 50000]` are built when not
    supplied. Returns a flattened `IRecommendationDTO`.
- **Composition root** (`app/core/services/`) — `CoreServices`
  class holds the cross-cutting singletons: `INetworkProvider`,
  `AnalyticsEngine`, `TAdapterRegistry` (`Map<chainId,
  IProtocolAdapter[]>`), and a `TAdapterPicker`. The picker
  defaults to "exact protocolId match → first registered";
  callers wanting stricter behaviour pass a custom `pickAdapter`
  to the factory. `CoreServices.useCases()` returns a *fresh*
  `ICoreUseCases` bundle on each call — use cases don't share
  state, simpler reasoning, no cross-test contamination. The
  thin factory `createCoreServices({network, adapters?,
  analytics?, pickAdapter?})` returns a new `CoreServices`;
  tests bypass the factory and instantiate `CoreServices`
  directly with mocks.

- **IRpcProvider `blockTag` extension** — `TReadContractParams`,
  `TMulticallCall<TReturn>`, and `TLogFilter` each gained an
  optional `readonly blockTag?: bigint`. `RpcProvider` passes it
  through as `blockNumber` to the underlying viem call when
  provided (and omits the key entirely when not, so the default
  behaviour of pinning to `latest` is preserved). No breaking
  change to existing call sites — every consumer that omits
  `blockTag` behaves exactly as before. Phase 8 history-provider
  reads will rely on this for archive-window RPC pinning.

- **`NetworkProvider` multicall3 wiring** — `NetworkProvider.to
  Chain()` previously didn't pass `multicall3Address` through to
  viem's `defineChain(...)`, which meant viem's `multicall`
  action refused to run with `ChainDoesNotSupportContract`. The
  fix honors the existing `TNetwork.multicall3Address` field
  (the bundled `ethereum` const now sets it to the canonical
  `0xca11bde05977b3631167028862be2a173976ca11`). The other
  bundled networks (`arbitrumNetwork`, `baseNetwork`,
  `sonicNetwork`) are deferred — they'll be updated when Phase 8
  reaches for them.

Module inventory (Phase 7 lands these files — they all exist in
the tree now):

```
app/core/application/
  errors/
    use_case_error.ts                     # abstract UseCaseError + code
    invalid_input_error.ts                # InvalidUseCaseInputError
    missing_history_error.ts              # MissingPoolHistoryError
    adapter_not_found_error.ts            # AdapterNotFoundError
    index.ts                              # barrel
  dtos/
    pool_analysis.dto.ts                  # IPoolAnalysisDTO
    position_simulation.dto.ts            # IPositionSimulationDTO + nested
    historical_replay.dto.ts              # IHistoricalReplayDTO
    recommendation.dto.ts                 # IRecommendationDTO + entry
    index.ts                              # barrel
  use_cases/
    adapter_resolver.type.ts              # TAdapterResolver
    discover_pools.use_case.ts            # DiscoverPoolsUseCase
    analyze_pool.use_case.ts              # AnalyzePoolUseCase
    simulate_position.use_case.ts         # SimulatePositionUseCase
    replay_historical_performance.use_case.ts
    compare_strategies.use_case.ts        # + toRecommendationDTO()
    index.ts                              # barrel
  index.ts                                # barrel (errors + DTOs + use cases)

app/core/services/
  core_services.class.ts                  # CoreServices + picker + ICoreUseCases
  create_core_services.factory.ts         # createCoreServices()
  index.ts                                # barrel

app/core/index.ts                         # now re-exports application + services
```

End-to-end verified via `app/core/test/application/use_cases/use_cases.test.ts`
(11/11 checks — DTO shapes, use-case orchestration, negative paths,
`IRpcProvider` `blockTag` extension). `pnpm typecheck` is
clean, `pnpm run build` produces the Nuxt bundle, and
`pnpm test` (all 34 tests across 7 files) passes.

Known caveats:

- **`ReplayHistoricalPerformanceUseCase` uses a stub `Position`**
  — amounts are zeroed because the historical-replay sim only
  consumes `position.range` (APR / IL / time-in-range metrics
  don't depend on amounts). Phase 8 may want to pre-quote via
  `adapter.quotePosition(...)` and thread real amounts in to
  support per-position `totalFeesInNumeraire` summaries.
- **`SimulatePositionUseCase.futurePrice.horizonSeconds`** is
  fixed to `SECONDS_PER_YEAR`. The future-price scenario is a
  *single-shot* price move; the horizon field exists for UI
  symmetry, not for math. Phase 8 may swap to a configurable
  horizon if the UI wants side-by-side 6m / 1y / 2y cards.
- **`feeRatePerSecond` derivation in the position use cases**
  follows the `explicit > targetApr/SPY > 0n` priority — same
  convention as Phase 5's `HistoricalReplaySimulation`. Callers
  wanting synthetic-fee runs (e.g. "what if the pool charged
  zero?") must pass `feeRatePerSecond = 0n` explicitly.
- **Default strategies / widths in `CompareStrategiesUseCase`
  are tuned for USDC/WETH-style pools** with σ ≈ 50% annualized
  and a target APR of ~30%. Other pools (stablecoin pairs,
  long-tail alts) should override `expectedApr`,
  `annualizedVolatility`, `riskFreeApr`, and `widthsTicks`
  before relying on the recommendation ranking.
- **The bundled `ethereum` constant uses `eth.llamarpc.com`**
  as its default RPC URL — fine for development but frequently
  521. Smoke tests and downstream UI code should register a
  `TNetwork` override pointing at a different public RPC when
  reliability matters. (The phase 7 smoke does exactly this.)
- **Adapter / `blockTag` integration is forward-looking.** No
  adapter in Phase 7 *uses* `blockTag` — only the smoke test
  pins a `readContract` to demonstrate the extension flows.
  Phase 8 will route history-provider reads through it.
- **`UseCaseError` is re-exported as both `UseCaseError` (type)
  and `UseCaseErrorClass` (class)** from the application barrel
  to avoid the name collision when re-exporting both a class
  declaration and its type alias from the same module. The class
  import works via `import { UseCaseErrorClass } from
  `@core/application'`.

---

### 6.15 Phase 8 — Nuxt UI (done)

Phase 8 wires the existing Core to a Nuxt 4 client UI. The
implementation is deliberately thin — every page is a
`<ClientOnly>` wrapper around a few `useCoreServices()` calls.
**Nothing in the Core changes in Phase 8.**

#### Modules added

```
app/
├── app.vue                              # <UApp> + <NuxtPage />
├── assets/css/main.css                  # @import "tailwindcss"; @import "@nuxt/ui";
├── layouts/default.vue                  # UHeader + UFooter shell
├── pages/
│   ├── index.vue                        # Discover: chain + tokenA/tokenB + fee tier
│   └── pool/[pool].vue                  # Tabs: Details / Recommendation / Simulation / Strategies
├── plugins/
│   └── core.client.ts                   # Builds the CoreServices tree, exposes $core + $switchChain
├── composables/
│   ├── useCoreServices.ts               # Null-safe accessor for $core
│   ├── useNetworks.ts                   # BUNDLED_NETWORKS + useActiveNetwork
│   ├── useAdapters.ts                   # adapterForChain resolver
│   └── usePoolLookup.ts                 # lookupPool + analyzePool wrappers
└── utils/
    └── formatDtos.ts                    # formatIL / formatAPR / formatVol / formatScore / shortAddress
```

#### Conventions picked up

- **Filenames follow Nuxt 4 conventions** — `useCoreServices.ts`,
  `useNetworks.ts`, `useAdapters.ts`, `usePoolLookup.ts`,
  `formatDtos.ts`, `core.client.ts`, `default.vue`. See §4.10 for the
  full table. Identifiers inside composables stay `use*` (Nuxt
  auto-imports them by name regardless of the file name).
- **Plugin is `.client.ts` only** — viem + adapters inflate the
  server bundle, so the registry is built on the browser. `<ClientOnly>`
  wraps every page that touches `$core`; the SSR pass emits an
  empty shell + a "Initializing LP analytics…" hint.
- **`useCoreServices()` returns `null` instead of throwing** during
  SSR (which we never trigger anyway). Pages check `if (!useCases)`
  before calling use cases.
- **BigInt values in DTOs** are rendered via `formatIL/APR/Vol/Score/Ratio1e18`
  helpers from `app/utils/format.ts`. Charts that need numbers
  convert through `Number(b) / 1e18`.
- **Nuxt UI components** — `UApp`, `UContainer`, `UCard`,
  `UFormField`, `UInput`, `USelectMenu`, `UButton`, `UBadge`,
  `UAlert`, `UTabs`, `UTable`. Tailwind 4 ships transitively with
  `@nuxt/ui`; `app/assets/css/main.css` is the global stylesheet
  entry.
- **`pnpm-workspace.yaml`** now has `vue-demi: false` (an inert Vue
  2/3 compatibility shim pulled in transitively by
  `@nuxt/ui`).

#### Caveats / open

- **Charts shipped in Phase 10 (see §6.17).** Earlier
  "no charts yet" caveat is now resolved for the Charts tab on
  the pool page; other surfaces (Discover, Analytics) remain
  textual.
- **All four bundled chains ship with a registered adapter AND
  a multicall3 address.** `app/plugins/core.client.ts` registers
  Uniswap V3 for Ethereum / Arbitrum / Base and Shadow CL for
  Sonic, so the network selector drives real adapter resolution.
  Arbitrum / Base / Sonic constants also carry
  `multicall3Address: '0xca11bde0...ca11'` (Phase 9 slice 4) so
  viem's `multicall` action resolves the contract on every
  bundled chain. See §6.17.
- **Public RPC endpoints are unreliable from the browser.**
  Single-endpoint transports failed in Phase 9 (Cloudflare
  error from one provider, `NetworkError` from llamarpc on
  `eth_call` from the browser). Fixed by wrapping each chain's
  RPC list in viem's `fallback` transport, then later pruned
  to a short, currently-healthy list. End-users who hit
  repeated failures can pin a personal endpoint (Alchemy /
  Infura / private node) through the in-app RPC settings
  drawer — that path is documented in §6.17. **There is no
  env-var escape hatch** — `.env.example` was removed in slice 4.
- **Phase 7 typecheck budget is preserved.** `pnpm typecheck`
  (`tsc --noEmit -p tsconfig.json`) remains the source of truth.
  The strict `.nuxt/tsconfig.app.json` (with `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `noImplicitOverride`) exposes 15 latent
  pre-Phase-8 bugs but they have no effect on the root typecheck
  or the production build — cleaning them up is Phase 9 work.
- **Session persistence ships in Phase 9.** The Discover page now
  restores the user's last chain + adapter selection across
  reloads via `app/composables/useSessionState.ts` (localStorage,
  client-only, defensive against SSR / quota errors). See §6.16.

---

### 6.16 Phase 9 — Advanced Features (in progress)

Phase 9 extends the platform **without changing the Core**. The
first landed slice covers two items that AGENT.md §6.10 / §6.15
flagged as Phase-9 follow-ups:

1. **Session persistence for the Discover page.** A new
   `app/composables/useSessionState.ts` stores the user's last
   chain id and protocol id in `localStorage` (keys `lp:v1:lastChainId`,
   `lp:v1:lastProtocolId`). The composable is client-only and
   defensive — every read/write is wrapped in a `try/catch` and
   gated on `import.meta.client` so SSR / private-mode browsers
   degrade gracefully to "no memory". The `DiscoverForm`
   component seeds itself from the persisted values (with
   fallback to `BUNDLED_NETWORKS[0]` and `ADAPTER_REGISTRY`),
   and the pool detail page also reads `useSessionState()` so a
   direct URL load without `protocolId` in the query still
   resolves to the user's last adapter. Writes happen
   reactively via `watch` on `chainId` / `protocolId`.

2. **Component split.** The four inline tab sections in
   `app/pages/pool/[pool].vue` and the form body in
   `app/pages/index.vue` were extracted into `app/components/`.
   The page files now own only the lifecycle and route
   orchestration; each tab / form is a focused, testable SFC.
   New components:
   - `app/components/DiscoverForm.vue` — the form body
   - `app/components/PoolHeader.vue` — back button + badges
   - `app/components/PoolDetailsTab.vue` — tokens + state + analytics
   - `app/components/RecommendationTab.vue` — table + rerun button
   - `app/components/SimulationTab.vue` — tick range + run controls
   - `app/components/StrategiesTab.vue` — per-strategy cards
   All follow the §4.10 PascalCase rule. `app/components/` was
   empty before Phase 9; Nuxt's component scanner picks them up
   automatically (no manual `import` in pages).

3. **User-pinned RPC URLs (slice 4).** End users can now pin a
   personal endpoint (Alchemy / Infura / private node) through
   a settings drawer on the Discover page header. The drawer
   reads/writes `app/composables/useRpcOverride.ts`, which
   stores `Record<chainId, url>` under `lp:v1:rpcOverrides`.
   `app/plugins/core.client.ts` reads that map at boot and
   *prepends* each override to the corresponding
   `TNetwork.rpcUrls` before constructing the
   `NetworkProvider`, so the user's endpoint wins; viem's
   `fallback` transport still tries the public URLs on
   transport-level failure. The drawer is a `USlideover` on
   `app/pages/index.vue` and renders `RpcSettings.vue`,
   which has one `UInput` + Save/Clear per bundled chain.
   This is the *only* RPC override path — the previous
   `VITE_*` env-var escape hatch was removed in slice 4
   (`.env.example` deleted, the `DEV_*_RPC` blocks stripped
   from every `*.const.ts`) so end users have a single
   source of truth.

4. **Multicall3 on every bundled chain (slice 4).** Added
   `multicall3Address: '0xca11bde0...ca11'` to Arbitrum /
   Base / Sonic constants. The address is the same on every
   EVM chain that deployed mds1's canonical Multicall3
   (Ethereum included). Unblocks viem's `multicall` action
   on those three chains — without it viem throws
   `ChainDoesNotSupportContract` at the first batched call.
   See §6.17 for the per-chain list.

5. **Token selector (slice 5).** Replaced the two raw `UInput`
   address fields in the Discover form with
   `app/components/TokenSelect.vue` dropdowns, sourced from
   `app/data/tokens/curated.ts` via `app/composables/useTokenList.ts`.
   The curated list ships in the bundle (no on-chain call, no
   token-list JSON fetch) and covers the common stables +
   native + WBTC + a couple of per-chain favourites on each
   of the four bundled chains. Each option renders the
   TrustWallet PNG logo + ticker + full name; the v-model
   binds the *address* (string), so the lookup use case and
   the submit flow are unchanged. Same-token-pair is caught
   with an inline warning; chain switch re-pre-fills with
   that chain's USDC + WETH (or USDC.e + wS on Sonic) if the
   current selection isn't in the new chain's curated list.
   The list is per-chain, not per-protocol — every bundled
   chain has at most one registered adapter today (Uniswap V3
   on Ethereum/Arbitrum/Base, Shadow CL on Sonic), and
   Uniswap V3's token universe is "any ERC-20 with a
   deployed pool", so a per-protocol filter would not
   meaningfully narrow anything. The composable's signature
   already takes `protocolId` so a future protocol-specific
   allowlist is a one-line change.

6. **Dynamic per-adapter token sources (slice 6).** Slice 5's
   curated list is now the *cold-start fallback*, not the
   primary source. Each adapter ships its own `ITokenSource`
   in `app/core/adapters/{uniswap/v3,shadow}/sources/`:
   `UniswapV3TokenSource` pulls
   `cdn.jsdelivr.net/gh/Uniswap/default-token-list@main/src/tokens/{chain}.json`
   (405 mainnet / 17 Arbitrum / 96 Base), `ShadowTokenSource`
   pulls `https://api.shadow.so/tokens` (~20k Sonic tokens).
   A tiny `tokenSources` registry in
   `app/core/adapters/sources/index.ts` maps `protocolId` →
   source. `useTokenList({ chainId, protocolId })` re-seeds
   from the curated list first (instant dropdown), then
   upgrades in the background; the result is cached in
   `localStorage` (`lp:v1:tokens:{protocolId}:{chainId}`,
   24h TTL). A `Refresh tokens` button in the Discover form
   header forces a cache-bypass refetch and surfaces a
   `UToast` on success (e.g. "20,411 tokens loaded") or
   failure (rate limit, CORS, offline → curated list kept).
   `ITokenSource` is in `@core/shared/types`; the
   implementations are pure-data classes with no RPC
   dependency, so the new layer doesn't break the §3
   dependency rules.

#### Dependency-rule compliance

- **Slice 5**: zero changes inside `app/core/**`.
- **Slice 6**: new files inside `app/core/adapters/{uniswap/v3,shadow}/sources/`
  and `app/core/adapters/sources/` (registry). All new code is
  pure data — `fetch()` plus a parsing function. No viem,
  no SDK, no RPC, no Vue/Nuxt. Adapters still take only
  `IRpcProvider` in their constructor; sources are a
  separate, lighter peer concept.
- New `ITokenSource` / `TTokenRow` types live in
  `@core/shared/types` (`app/core/shared/types/token_source.type.ts`).
  `app/data/tokens/curated.ts` re-exports `TTokenRow` as
  the deprecated alias `ITokenRow` so old imports keep
  compiling.
- No new Nuxt modules added (`@vueuse/core` was deliberately
  not pulled in — the localStorage helper is ~50 lines of
  plain TS).
- `pnpm typecheck`, `pnpm exec nuxt prepare`, and `pnpm run build`
  all pass clean after the slice 6 changes.

#### Post-slice-6 polish (no version bump)

- **Pool page tab crash fix.** The original `UTabs` `#content`
  slot used a `v-if`/`v-else-if` chain over the four tab
  components. When the user navigated to a second pool page
  while a non-first tab was active (the page component is
  reused, so `selectedTab` is preserved), Reka UI's
  `<Presence>` wrapper — which `unmountOnHide: true` requires
  for every `<TabsContent>` — threw *"Unhandled error during
  execution of watcher callback"* during the in-place
  re-mount, leaving every tab body empty. The fix has two
  parts: (1) the slot now uses `<component :is="tabComponents[item.value]">`
  with a `getTabProps(item.value)` helper so each `<TabsContent>`
  gets exactly one component child instead of a four-branch
  conditional fragment; (2) a `watch(poolAddress)` resets
  `selectedTab` (and the analysis/recommendation/simulation
  refs) to a clean state on every new pool, so the
  cross-page state-preservation issue cannot recur.
- **`formatAmountShort` auto-import.** The previous comment
  in `PoolDetailsTab.vue` claimed `formatAmountShort` was
  auto-imported from `app/core/shared/utils` via the
  `@core/*` alias, but Nuxt's auto-import scan only covers
  `app/utils/`. The function was therefore undefined at
  runtime and the "Pool Details" tab crashed the first time
  it tried to render a price. `app/utils/formatDtos.ts` now
  re-exports `formatAmountShort` from `@core/shared/utils`,
  so it picks up the standard auto-import alongside the
  existing `formatIL` / `formatAPR` / `formatVol` helpers.
  The misleading comment in `PoolDetailsTab.vue` was
  replaced with an accurate one.
- **Simulation tab renderer.** Phase 9 slice 2 extracted the
  Simulation tab into `app/components/SimulationTab.vue`,
  but the results block was a one-line placeholder
  (`"Use the canonical use cases (...)"`) that the user saw
  every time they clicked "Run simulation". The tab now
  renders every block the `simulatePosition.execute(...)`
  use case actually populates: **Quote** (liquidity,
  amount0, amount1), **Deposit** (deposit-side amounts and
  notional in the selected numeraire), **Future price
  scenario** (terminal price / value / IL / horizon) when
  supplied, **Historical replay** (APR, mean/min/max/final
  IL, time-in-range, max drawdown, total fees, replay
  window) when supplied, and **Monte Carlo** (paths,
  mean / P05 / P50 / P95 of terminal value & IL,
  time-in-range) when supplied. Each block renders only if
  its corresponding DTO field is non-null. The page also
  computes `token0Amount` from the user-typed `principal` +
  `currentPrice` so the position is correctly sized when
  the numeraire is `token1` (WETH / etc.). New helpers in
  `formatDtos.ts`: `formatTokenAmount(raw, decimals)`,
  `formatPriceShort(raw, priceDecimals)`, and
  `formatSeconds(bigint)` for the time strings.

#### What's still Phase 9 backlog

The README §9 list is long. Items not yet started:

- Additional DEX adapters (Algebra, Pancake V3, more) — touches
  Core / Phase 2.
- Alternative history providers (database, APIs) — touches Core.
- Alternative price / history sources.
- AI recommendation strategy — Phase 6 work.
- Cross-protocol pool comparison.
- User-defined optimization profiles.
- Export & reporting.
- Performance: workers, caching, IndexedDB.
- Charts (bar / line) for the Analytics tab.
- Cleaning up the 15 latent bugs in the strict `.nuxt/tsconfig.app.json`.

---

### 6.17 Phase 9 — RPC reliability (fallback transport)

Phase 9 slice 2. The Discover form was unusable on Ethereum
mainnet because every public RPC we pointed at either returned
`NetworkError when attempting to fetch resource` (llamarpc) or
`reverted with reason: Internal error` (a Cloudflare-backed
endpoint) when the browser issued `eth_call` against the
Uniswap V3 factory. From a Node smoke test the same calls
worked, confirming the failure was transport-layer (CORS,
rate-limit, or 5xx) rather than a code bug.

#### The fix

- **`TNetwork.rpcUrls: readonly string[]`** — every network
  constant now ships an ordered list of 2-3 public endpoints
  instead of a single `rpcUrl`. The first is the primary; the
  rest are fallbacks.
- **`create_rpc_provider.factory.ts`** builds viem's
  `fallback([http(u1), http(u2), http(u3)])` transport. viem
  rotates through the list on transport-level failures, so
  `readContract`, `multicall`, `getBlock`, etc. all benefit
  without per-call code changes.
- **`RpcProvider` constructor** now takes `rpcUrls: readonly
  string[]` instead of `rpcUrl: string`. The `IRpcProvider`
  interface is unchanged.
- **`NetworkProvider.rpc()`** passes `network.rpcUrls` through.
- **`TNetwork.rpcUrl: string`** is kept as a convenience
  "first entry" for logging/display, and the factory still
  accepts a deprecated `rpcUrl` field for any caller that
  hasn't migrated (defensive `||` chain). No new dependencies.

#### Per-chain RPC lists

```
Ethereum (chainId 1)
  primary: https://eth.drpc.org
  fallbacks: https://ethereum-rpc.publicnode.com,
             https://eth.merkle.io,
             https://cloudflare-eth.com
  (llamarpc, 1rpc.io/eth, rpc.flashbots.net intentionally
  removed — see Slice-5 / Sep 2026 health check:
   - llamarpc: NetworkError from browser
   - 1rpc.io/eth: Nodies rate-limited
   - rpc.flashbots.net: eth_call not whitelisted
   - cloudflare-eth.com: -32603 Internal error from many
     regions; kept as tertiary only)

Arbitrum (chainId 42161)
  primary: https://arb1.arbitrum.io/rpc
  fallbacks: https://arbitrum-one-rpc.publicnode.com,
             https://rpc.ankr.com/arbitrum

Base (chainId 8453)
  primary: https://mainnet.base.org
  fallbacks: https://base-rpc.publicnode.com,
             https://rpc.ankr.com/base

Sonic (chainId 146)
  primary: https://rpc.soniclabs.com
  fallback: https://rpc.ankr.com/sonic_mainnet
```

#### User-pinned RPC override (slice 4)

The end-user RPC override path. The only one — there is no
env-var escape hatch.

- **`app/composables/useRpcOverride.ts`** — a tiny client-only
  composable that stores `Record<chainId, url>` under
  `lp:v1:rpcOverrides` in `localStorage`. Exposes
  `getOverride(chainId)`, `setOverride(chainId, url)`,
  `clearOverride(chainId)`, and `clearAll()`. SSR-safe
  (`import.meta.client` guard) and quota-safe (every read/write
  is in a `try/catch`).
- **`app/plugins/core.client.ts`** reads the override map at
  plugin boot and *prepends* each pinned URL to the
  corresponding chain's `TNetwork.rpcUrls` before constructing
  the `NetworkProvider`. The override wins; viem's
  `fallback` transport still cycles through the public
  endpoints on transport-level failure.
- **`app/components/RpcSettings.vue`** is the UI: one
  `UInput` per bundled chain with Save / Clear buttons,
  `useToast` feedback on save/clear, http(s) URL validation.
- **`app/pages/index.vue`** wires it into a `USlideover`
  opened from a "Custom RPC" button in the Discover page
  header.
- **No env var.** Previously each network constant read
  `import.meta.env.VITE_*_RPC` to prepend a dev-time
  endpoint. That path was removed in slice 4 because it
  duplicated the runtime path, was easy to miss, and gave
  the app two different mechanisms for the same job.
  `.env.example` was deleted; the `DEV_*_RPC` blocks were
  stripped from every `*.const.ts`. End users (and devs)
  pin endpoints through the in-app drawer.

#### What this does NOT fix

- **All public RPCs for a chain are down at once.** No
  client-side fallback can help here — if every URL in
  `TNetwork.rpcUrls` is returning errors, the fallback
  transport eventually surfaces the last error. The user
  must pin a personal endpoint (Alchemy / Infura / private
  node) through the settings drawer to recover.

#### Dependency-rule compliance

- Core-only change in slice 2 — `app/composables/**`,
  `app/components/**`, `app/pages/**`, `app/plugins/**` were
  untouched. Slices 3 and 4 added `useRpcOverride.ts`,
  `RpcSettings.vue`, and a `withOverride()` step in
  `core.client.ts`; those are pure UI / composition-root
  additions and don't import anything from `app/composables/`
  beyond what Phase 8 already had.
- `IRpcProvider` interface signature unchanged across all
  four slices — `NetworkProvider`, `CoreServices`, and the
  history provider didn't need updates.
- `pnpm typecheck`, `pnpm exec nuxt prepare`, `pnpm run build`
  all pass clean.

---

### 6.18 Phase 10 — Charts (done)

Phase 10 closes the Phase 8 backlog item "Charts (bar / line) for
the Analytics tab" by adding a fifth tab to the pool page
(`details | recommendation | simulation | strategies | charts`).
The tab is a one-page **price-history line chart** with the
**top-1 strategy's price range overlaid as a green box** so the
user can visually see "where to enter" relative to recent price
action.

#### New use case: `GetPoolHistoryUseCase`

- `app/core/application/use_cases/get_pool_history.use_case.ts`
- DTO: `app/core/application/dtos/pool_history.dto.ts`
  (`IPoolHistoryDTO` with `snapshots: IHistorySnapshotDTO[]`,
  `source: 'on-chain' | 'synthetic'`, `fromBlock`, `toBlock`,
  `annualizedVolatility`).
- Strategy:
  1. Resolve the adapter + fetch the *current* pool state.
  2. Walk back `numSnapshots` blocks at `blockStep` intervals
     (defaults: 60 snapshots, per-chain step in
     `DEFAULT_BLOCK_STEP` — 200 blocks for Ethereum/Arbitrum,
     600 for Base/Sonic).
  3. For each historical block, call the new
     `IProtocolAdapter.getPoolStateAtBlock(pool, blockTag)` (which
     uses the existing `IRpcProvider.multicall({ blockTag })` plumbing
     to pin `slot0` to that block) and the new
     `IRpcProvider.getBlock(blockNumber)` to get the timestamp.
  4. Convert each `sqrtPriceX96` to a `Price` via
     `sqrtPriceX96ToPrice(...)`.
  5. If any step throws (archive node unavailable, RPC rejected
     the historical block tag, etc.) fall back to a
     **deterministic synthetic GBM path** anchored at the current
     price — never block the UI on a partial archive. The DTO's
     `source` field tells the UI which path produced the series.
- Default max cost: 200 snapshots. Pass `maxSnapshots: 0` to
  disable the synthetic fallback and surface the underlying
  error (useful for testing).
- Skips the `volatilityFromHistory` call when the price didn't
  move across the window — common for stablecoin pairs on a
  short horizon, where the volatility util would otherwise
  divide by zero.

#### Adapter extension: `getPoolStateAtBlock`

- `IProtocolAdapter.getPoolStateAtBlock(pool, blockNumber): Promise<TPoolState>`
  is a new optional-ish method. Implemented in both
  `UniswapV3Adapter` (via `UniswapV3PoolStateReader.readStateAtBlock`)
  and `ShadowAdapter` (via `ShadowPoolStateReader.readStateAtBlock`).
- Reads only `slot0` at the historical block; liquidity /
  fee-growth fields are filled with `0n` (the chart only needs
  the price, so fetching the rest would just waste RPC budget).
- Token metadata (`token0`, `token1`, `fee`, `tickSpacing`) is
  fetched at *latest* (these are constant for a pool).

#### RPC provider fix: `getBlock` bigint support

- `IRpcProvider.getBlock(tag: TBlockTag)` previously forwarded
  bigint tags as `blockTag: <bigint>` to viem 2.55+, which sends
  the unprefixed decimal string and makes the RPC reject it
  with "hex string without 0x prefix". The wrapper now splits
  the two viem params — bigint → `blockNumber`, string →
  `blockTag` — so `RpcHistoryProvider.replayBlocks` and the new
  `getPoolStateAtBlock` both work end-to-end.

#### UI: `ChartsTab` + `PriceChart.client.vue`

- `app/components/PriceChart.client.vue` — Chart.js wrapper.
  `.client.vue` is the Nuxt 4 convention for client-only
  components; chart.js touches the DOM and would otherwise break
  SSR. The page is already wrapped in `<ClientOnly>`, but the
  suffix belt-and-braces guarantees the import never runs
  server-side.
- `app/components/ChartsTab.vue` — presentational tab. Fetches
  history on mount (and re-fetches when the pool address
  changes), derives the top-1 strategy from the recommendation
  DTO via `tickToPrice(tickLower/tickUpper)`, and renders the
  chart with the strategy box + a dashed "now" line.
- `app/pages/pool/[pool].vue` — added a fifth tab entry
  (`{ value: 'charts', label: 'Charts', icon: 'i-lucide-line-chart' }`),
  a `charts: resolveComponent('ChartsTab')` entry in the
  `tabComponents` map, and a `case 'charts':` branch in
  `getTabProps` that forwards `pool`, `chainId`, `protocolId`,
  `analysis`, and `recommendation`.

#### New dependency

- `chart.js@^4` + `vue-chartjs@^5` + `chartjs-plugin-annotation@^3`
  (~80kB gzipped). The annotation plugin powers the
  `box` overlay (top-1 strategy price range) and the
  `line` overlay (current price marker) natively, so we
  don't hand-roll any SVG.

#### Verification

- `pnpm typecheck` ✓
- `pnpm exec nuxt prepare` ✓
- `pnpm run build` ✓
- `pnpm test app/core/test/application/use_cases/get_pool_history.test.ts` ✓
  — exercises both on-chain history (USDC/WETH 0.05% and WETH/USDT
  0.3% on Ethereum mainnet) and the synthetic fallback path.
  Confirms `getPoolStateAtBlock` returns a non-zero tick at a
  historical block.

---

## 7. Roadmap (from README)

Phases 0–7 are complete. Phases 0–9 are described in detail in
`README.md`. The current code covers the foundational Core
(skeleton + dep boundaries, providers + adapters, value objects,
math engine including `exp()` and `sqrtPriceX96ToPrice`, eight
domain modules, two range generators, four simulation levels,
and the recommendation engine — five concrete strategies plus
the orchestrator, value objects, and scoring config). When
implementing a new phase, **read the relevant section of README
first**, then build the smallest vertical slice that compiles and
runs end-to-end.

Suggested order (matches README):
1. Project skeleton & dep boundaries *(done)*
2. Provider + adapter foundations *(done)*
3. Uniswap V3 + Shadow adapter *(done — Phase 2; live smoke-tested
   against Ethereum mainnet USDC/WETH 0.05%)*
4. Core domain *(done — Phase 3; value objects, math, eight domain
   modules; live-tested via `pnpm test app/core/test/domains/pool/pool.test.ts`)*
5. Math engine *(done — Phase 4; IL, APR, capital efficiency,
   realized volatility, Sharpe-like score; live+synthetic tests in
   `app/core/test/math/math-engine.test.ts`, run via
   `pnpm test app/core/test/math/math-engine.test.ts`)*
6. Simulation engine *(done — Phase 5; four levels — deposit,
   future price, historical replay, Monte Carlo; live+synthetic
   tests in `app/core/test/domains/simulation/simulation.test.ts`,
   run via `pnpm test app/core/test/domains/simulation/simulation.test.ts`)*
7. Recommendation engine *(done — Phase 6; five concrete
   strategies + orchestrator + scoring config + value objects;
   live+synthetic tests in
   `app/core/test/domains/recommendation/recommendation.test.ts`,
   run via
   `pnpm test app/core/test/domains/recommendation/recommendation.test.ts`)*
8. Application layer use cases *(done — Phase 7; five use cases,
   four DTOs, three use-case errors, IRpcProvider `blockTag`
   extension, and `CoreServices` composition root — live +
   synthetic tests in
   `app/core/test/application/use_cases/use_cases.test.ts`, run via
   `pnpm test app/core/test/application/use_cases/use_cases.test.ts`,
   11/11 checks)*
9. Nuxt UI *(done — Phase 8; see §6.15 for module inventory;
   `@nuxt/ui` v4 wired with Tailwind 4 CSS, plugin
   `app/plugins/core.client.ts` mounts the CoreServices
   composition root, composables in `app/composables/`
   (`useCoreServices.ts`, `useNetworks.ts`, `useAdapters.ts`,
   `usePoolLookup.ts`), two pages (`index.vue`, `pool/[pool].vue`)
   plus a default layout; both pages are `<ClientOnly>` because
   the plugin ships viem + adapters and is client-only;
   `pnpm run build` clean and `pnpm smoke:phase7` still 18/18)*
10. Advanced features

---

## 8. Practical Do's and Don'ts

### Do
- Keep files small and single-purpose.
- Add a barrel `index.ts` for every new folder.
- Translate SDK types into `T*` types at the adapter boundary.
- Use `bigint` for on-chain integers.
- Use `@core/...` when importing from outside `app/core`.
- Add a one-line path comment at the top of every new file.
- Match the existing 2-space indentation and trailing-newline style.
- When in doubt, copy the structure of the closest existing file.

### Don't
- Don't use `npm` or `yarn` — the project is pnpm-only.
- Don't import viem outside `providers/rpc/**` and protocol-specific
  SDK wrappers in `adapters/**`.
- Don't import anything from `app/composables/`, `app/components/`,
  `app/pages/`, or `vue`/`nuxt` from inside `app/core/**`.
- Don't introduce new third-party dependencies without an explicit
  reason — the current stack is intentionally minimal.
- Don't add `any`, `// @ts-ignore`, or empty catch blocks.
- Don't leak SDK classes out of an adapter — wrap them.
- Don't add a new dependency rule exception. If a domain "needs" an
  adapter, it doesn't — the dependency direction is wrong.
- Don't add `console.log` in Core code.
- Don't write code that touches the wallet. The app is wallet-less.
- Don't use PascalCase / camelCase / kebab-case filenames **inside
  `app/core/**`** — Core files must stay snake_case with a type
  postfix (see §4.10). The UI layer (composables, components,
  pages, layouts, plugins, middleware, utils) is exempt and
  follows the Nuxt 4 conventions table in §4.10.
- Don't introduce **Playwright, Puppeteer, Cypress, or any other
  browser end-to-end test runner.** No `@playwright/test`,
  `playwright`, `puppeteer`, `cypress` as a dependency. No browser
  smoke scripts, no headless-chromium tests. Tests run in Node
  via Vitest only (see §11.1).
- Don't commit code before the user has explicitly approved the
  diff. Show the diff (or a `git diff --stat`), wait for an
  unambiguous "approved" / "go ahead" / "commit it" (or
  equivalent), then commit. No speculative commits, no "I'll just
  push and we'll see" — see §11.6.

---

## 9. Quick Templates

### 9.1 New shared type
File: `app/core/shared/types/new_thing.type.ts` (one type per file).
```ts
// app/core/shared/types/new_thing.type.ts

export interface TNewThing {
  id: string;
  value: bigint;
}
```
Then add `export * from './new_thing.type';` to `shared/types/index.ts`.

### 9.2 New network
File: `app/core/network/networks/optimism.const.ts` (single exported
constant → `.const.ts`).
```ts
// app/core/network/networks/optimism.const.ts

import type { TNetwork } from '../../shared/types';

export const optimism: TNetwork = {
  id: 10,

  name: 'Optimism',

  rpcUrl: 'https://mainnet.optimism.io',

  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
};
```
Then add `export * from './optimism.const';` to `network/networks/index.ts`.

### 9.3 New adapter
1. Create the adapter **interface** file
   `app/core/adapters/<protocol>/<protocol>_adapter.interface.ts`
   (extend the shared `IProtocolAdapter` or define a protocol-specific
   one).
2. Create the **class** file
   `app/core/adapters/<protocol>/<protocol>_adapter.class.ts`
   that `implements` the interface, with `readonly id/name/version`.
3. Constructor takes `IRpcProvider`.
4. Translate all returns to `T*` types.
5. Re-export from `app/core/adapters/<protocol>/index.ts` (barrel).
6. Add the protocol re-export to `app/core/adapters/index.ts`.

### 9.4 New use case
File: `app/core/application/use_cases/<thing>.use_case.ts`. Use
cases are **plain ES classes** that take constructor-injected
dependencies. They don't reach for any DI container — the
composition root (`app/core/services/core_services.class.ts`)
wires them. Tests instantiate use cases directly with mocks.

```ts
// app/core/application/use_cases/<thing>.use_case.ts

import type { TAdapterResolver } from './adapter_resolver.type';
import type { <IDTO> } from '../dtos/<thing>.dto';
import { InvalidUseCaseInputError } from '../errors/invalid_input_error';

export interface I<Thing>Input {
  readonly chainId: number;
  readonly pool: `0x${string}`;
  // ...other required/optional fields...
}

/**
 * <One-line description>.
 *
 * Detailed docstring — covers validation, side effects, DTO
 * shape, scale conventions, and the recommended call sites in
 * the UI layer.
 */
export class <Thing>UseCase {
  readonly id = '<thing>';

  constructor(
    private readonly resolveAdapter: TAdapterResolver,
    // ...other constructor-injected dependencies...
  ) {}

  async execute(input: I<Thing>Input): Promise<<IDTO>> {
    if (!input.pool) {
      throw new InvalidUseCaseInputError(this.id, 'pool', 'address is required');
    }
    // ...validate other inputs...
    const adapter = this.resolveAdapter(input.chainId, input.protocolId);
    // ...orchestrate domains + adapters + math...
    return { /* DTO */ };
  }
}
```

Conventions:

- `*Input` interfaces live next to the use case class in
  `*.use_case.ts`.
- `*DTO` interfaces live in `app/core/application/dtos/*.dto.ts`.
- Errors (input + adapter + history) come from
  `app/core/application/errors/`. Throw `InvalidUseCaseInputError`
  for bad inputs, `AdapterNotFoundError` (via
  `TAdapterResolver`) for missing chains. Don't throw
  `MissingPoolHistoryError` unless history is genuinely required.
- Re-export the new use case + input type from
  `app/core/application/use_cases/index.ts` (grouped with its
  kind, classes after interfaces).
- Don't reach for `IRpcProvider` directly — the resolver hands
  you the right `IProtocolAdapter` for the chain, and the adapter
  knows how to read its protocol's state.

### 9.5 New composable
File: `app/composables/use<Thing>.ts` (or kebab-case
`use-thing.ts` — Nuxt 4 conventions from §4.10). Composables
live **outside `app/core/`** and are auto-imported by Nuxt.
The **identifier** inside the file is `camelCase` and prefixed
with `use*` (e.g. `usePoolLookup`); that's what Nuxt binds to
the auto-import. Don't export a `default`.

The Phase 8 convention is to **delegate to `useCoreServices()`** at
the top of the file. This keeps the call-site compact:
```vue
<script setup lang="ts">
const { services, useCases } = useCoreServices();
const { analyzePool, lastError, isAnalyzing } = usePoolLookup();
</script>
```
```ts
// app/composables/usePoolLookup.ts

import type { TAddress } from '@core/shared/types';

/**
 * Reactive lookups for the Discover-Pools / Analyze-Pool UI steps.
 * Always call `useCoreServices()` at the top so SSR is no-op safe.
 */
export function usePoolLookup() {
  const { services, useCases, switchChain, network } = useCoreServices();
  const { option } = useActiveNetwork();

  const isLooking = ref(false);
  const lastError = ref<string | null>(null);

  async function lookupPool(input: {
    chainId: number;
    tokenA: TAddress;
    tokenB: TAddress;
    fee: number;
  }) {
    if (!useCases) { lastError.value = 'Core services not ready'; return null; }
    isLooking.value = true;
    try {
      const rows = await useCases().discoverPools.execute({
        chainId: input.chainId,
        tokenA: input.tokenA,
        tokenB: input.tokenB,
        fee: input.fee,
      });
      return rows[0] ?? null;
    }
    catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      return null;
    }
    finally {
      isLooking.value = false;
    }
  }

  return { option, network, lastError: readonly(lastError), isLooking: readonly(isLooking), lookupPool };
}
```
A composable file is **thin glue** between Nuxt and Core — no business
logic, only object construction. Always:
- Return null-safe reactive refs (`readonly()` is preferred so
  callers don't mutate them).
- Wrap any RPC-touching logic in `try/catch` so `AdapterNotFoundError`
  and friends surface as user-friendly strings via `lastError`.
- Pair with `<ClientOnly>` in the page template — the
  `app/plugins/core.client.ts` plugin is client-only.

---

## 10. Definition of Done

Before declaring a task complete, verify:

- [ ] Installed/updated dependencies with **pnpm** (e.g. `pnpm install`,
      `pnpm add <pkg>`). No `npm` or `yarn` commands anywhere.
- [ ] `pnpm run build` (i.e. `nuxt build`) succeeds.
- [ ] `pnpm exec nuxt prepare` succeeds.
- [ ] `pnpm test` (Vitest) passes — all suites green.
- [ ] `pnpm typecheck` is clean.
- [ ] No new imports violate the dependency rules in §3.
- [ ] No `any`, no `// @ts-ignore`.
- [ ] Every new folder has a barrel `index.ts`.
- [ ] Every new file has a leading path comment.
- [ ] Every new file inside `app/core/**` follows the
      **snake_case + type postfix** rule from §4.10 (e.g.
      `rpc_provider.class.ts`, `create_rpc_provider.factory.ts`).
      UI-layer files (`app/composables/`, `app/components/`,
      `app/pages/`, `app/layouts/`, `app/plugins/`,
      `app/middleware/`, `app/utils/`) follow the Nuxt 4
      conventions in §4.10 (e.g. `useCoreServices.ts`,
      `PoolCard.vue`, `core.client.ts`).
- [ ] On-chain values use `bigint`.
- [ ] SDK types do not leak out of an adapter folder.
- [ ] `app/composables/**` only contains thin glue, no business logic.
- [ ] No `package-lock.json` or `yarn.lock` was introduced; only
      `pnpm-lock.yaml` is tracked.
- [ ] **Showed the user a diff (`git status` + `git diff --stat`) and
      received explicit approval before committing.** No commits
      without a green light. See §11.6.

---

## 11. Testing

### 11.1 No browser / no Playwright
Do **not** add Playwright, Puppeteer, Cypress, or any other
binary-driving browser E2E runner. The app is wallet-less, runs
entirely in the browser as a static Nuxt SPA, and the Core is
framework-agnostic — there is no UI to drive with a browser. All
tests run in plain Node via Vitest.

What this forbids concretely:
- `playwright`, `@playwright/test`, `puppeteer`, `cypress`,
  `webdriverio`, `testcafe` — none of these as dev deps.
- A `tests/e2e/` or `e2e/` directory at the repo root.
- A `playwright.config.*` file.
- Any `npm install -g <something>` that pulls a browser binary.
- Mocking the DOM via `jsdom`/`happy-dom` for chart components.
  Chart rendering is pure Canvas; the data is tested directly.

If a UI-flow concern genuinely needs a browser, raise it with the
user before adding any of the above. The expected outcome of
that conversation is "no, we don't need a browser" — the answer
so far has been unanimous.

### 11.2 Test location
Tests live under `app/core/test/`, **never** at the repo root.
The previous top-level `scripts/` directory was retired; the
`pnpm smoke:phase*` scripts were rewritten as Vitest files. The
new layout (see §6.8) mirrors `app/core/` so the test for a
module is co-located with the module tree:
- `app/core/test/scripts/smoke.test.ts` — root sanity
- `app/core/test/domains/pool/pool.test.ts` — Phase 3
- `app/core/test/math/math-engine.test.ts` — Phase 4
- `app/core/test/domains/simulation/simulation.test.ts` — Phase 5
- `app/core/test/domains/recommendation/recommendation.test.ts` — Phase 6
- `app/core/test/application/use_cases/use_cases.test.ts` — Phase 7
- `app/core/test/application/use_cases/get_pool_history.test.ts` — Phase 10

The directory MUST be picked up by Vitest's `include` glob
(`vitest.config.ts`). Shared helpers live alongside the tests as
`_helpers.ts` (leading underscore) and `test-constants.ts` (no
`.test.` suffix) so Vitest never executes them. New test files
must follow the same convention.

### 11.3 Vitest idioms
Tests are written in Vitest's first-class API. **No** ad-hoc
`console.log` + `process.exit(1)` scripts, no hand-rolled
assertion helpers, no `tsx`-style shebang scripts.

- `import { describe, it, expect, beforeAll, afterAll } from
  'vitest';` — globals are off (config: `test.globals: false`),
  so always import explicitly.
- Assertions are real `expect(...)` calls: `toBe`, `toEqual`,
  `toBeGreaterThan`, `toBeInstanceOf`, `rejects.toBeInstanceOf`,
  etc. No `if (!ok) throw new Error(...)` patterns.
- `it.skip(...)` is fine for tests that require a specific
  environment (e.g. live mainnet RPC) when running offline.
- Asynchronous setup goes in `beforeAll` / `beforeEach`; teardown
  in `afterAll` / `afterEach`. Don't `await` in the test body
  when the setup is reusable.
- Test names follow `it('does X under condition Y', ...)` —
  imperative, descriptive, no "test that" prefix.
- Don't introduce chai, jest, mocha, or assertion libraries other
  than Vitest's `expect`.

### 11.4 Test commands
Vitest is the only test runner. The `package.json` script map:

| Command | Effect |
|---|---|
| `pnpm test` | `vitest run` — full suite, one-shot, default reporter |
| `pnpm test:watch` | `vitest` — interactive watch mode |
| `pnpm test:ui` | `vitest --ui` — opens the Vitest UI dashboard |
| `pnpm test:coverage` | `vitest run --coverage` — opt-in coverage report |

The `pnpm smoke:phase*` scripts that used to live in
`package.json` are **deleted**. They have no equivalent — use
`pnpm test app/core/test/<path>.test.ts` to run a single file
instead.

There is no `--no-coverage` flag on `pnpm test`; coverage is
opt-in via `pnpm test:coverage` so the default run stays fast.

### 11.5 Live RPC in tests
Tests may issue live RPC reads (the Phase 7 + 10 tests do this
against `ethereum-rpc.publicnode.com`). The convention is:
- Wrap every live read in a `try/catch` that degrades to a
  deterministic synthetic fixture on transport failure. Public
  RPCs are unreliable; the suite must stay green offline.
- Live reads are tolerable **only** because they are
  `await fetch(...)`-shaped network I/O, not browser I/O. They
  use the same viem stack the production code uses.
- The first `it(...)` in a test file that depends on live state
  should `try { live = await loadLivePool(); } catch { live =
  null; }` and skip the live-only assertions if `live === null`.
  The synthetic fallback is always present, so the test
  exercises *something* even when the public RPC is down.

### 11.6 Approval gate before commit
**No commit without explicit user approval.** The agent's
standard pattern is:
1. Make the changes.
2. Run the verification suite (`pnpm typecheck`, `pnpm test`,
   `pnpm exec nuxt prepare`, `pnpm run build`).
3. Show the user a `git status` + `git diff --stat` summary.
4. **Wait.** Do not commit until the user replies with an
   unambiguous "approved" / "go ahead" / "commit it" / "ship
   it" (or a local equivalent).
5. Then commit, with a message that summarises the change in
   one line.

This applies to *every* commit, including small doc tweaks and
refactors. A speculative commit ("I'll just push and we'll see")
is a violation. If the user has already given blanket approval
for a well-scoped task, that counts — but if in doubt, ask.

The Definition of Done in §10 carries a matching checkbox.

---

*This file is the source of truth for how to write code in this repo.
When the project evolves, update this file in the same change.*
