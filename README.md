# Liquidity Position Analysis Engine

### Vision
```
                +----------------------+
                |     Nuxt 4 UI        |
                +----------+-----------+
                           |
                           |
                  Application Layer
                           |
        +------------------+------------------+
        |                                     |
 Recommendation Engine                 Simulation Engine
        |                                     |
        +------------------+------------------+
                           |
                        Core Domain
                           |
     +---------+-----------+----------+-----------+
     |         |           |          |           |
   Pool     Market      Position   Analytics   History
                           |
                     Shared Math
                           |
                   Protocol Abstraction
                           |
        ----------------------------------------
        |                                      |
 Uniswap V3 Adapter                   Shadow Adapter
        |                                      |
        -------------- Providers --------------
                       |
          RPC (viem) / History Provider
```
Notice that **Nuxt knows Core**, but **Core never knows Nuxt**

---

### Proposed Project Structure
```
app/
│
├── core/
│
│   ├── adapters/
│   │     ├── uniswapV3/
│   │     ├── shadow/
│   │     └── ...
│   │
│   ├── providers/
│   │     ├── rpc/
│   │     ├── history/
│   │     └── ...
│   │
│   ├── application/
│   │     ├── useCases/
│   │     ├── services/
│   │     └── orchestration/
│   │
│   ├── domains/
│   │
│   │     ├── pool/
│   │     ├── market/
│   │     ├── position/
│   │     ├── simulation/
│   │     ├── recommendation/
│   │     ├── analytics/
│   │     ├── strategy/
│   │     └── history/
│   │
│   ├── math/
│   │
│   ├── shared/
│   │
│   │     ├── interfaces/
│   │     ├── types/
│   │     ├── valueObjects/
│   │     ├── utils/
│   │     └── errors/
│   │
│   └── index.ts
│
├── composables/
├── pages/
├── components/
└── plugins/
```  
---  

### Why Application Layer?
DDD normally separates
```
UI

↓

Application

↓

Domain

↓

Infrastructure
```  
The Application layer orchestrates work.

**Example:**
```
AnalyzePoolUseCase

↓

History Provider

↓

Pool Adapter

↓

Recommendation Engine

↓

Simulation

↓

Return DTO
```  
No domain should coordinate other domains.

---

### Domain Design
I would split the project like this.
```
Pool

- PoolState
- Tick
- Liquidity
- Fees
- CurrentPrice

--------------------

Market

- Prices
- Volatility
- Market State

--------------------

Position

- Position
- Deposit
- Range
- Capital Allocation

--------------------

Simulation

- Deposit
- Future Price
- Historical Replay
- Monte Carlo

--------------------

Recommendation

- Recommendation Engine
- Score
- Candidate Generation

--------------------

Strategy

- Fee Maximizer
- Low IL
- Balanced
- Custom Weight

--------------------

Analytics

- APR
- APY
- IL
- Capital Efficiency
- Sharpe
- Utilization

--------------------

History

- Snapshot
- Candle
- Block Replay
```  
Notice every domain has exactly one responsibility.

---  

### Shared Abstractions
The Core should never know Uniswap.
Instead everything becomes protocol-neutral.

**Example**
```
TPoolState

TPosition

TTickRange

TLiquidity

TPrice

TFeeGrowth

TSwap

TPoolSnapshot

TMarketSnapshot
```
Adapters translate protocol objects into these.

### Adapter Responsibility
Adapters only answer:
> "How does this protocol work?"

**Example**
```
Uniswap SDK

↓

TickMath

↓

LiquidityAmounts

↓

Pool

↓

Convert

↓

TPoolState
```  
Core never imports SDK packages.

---  

### Provider Responsibility
Provider answers
> "Where did the data come from?"

RPC Provider
```
Pool

Ticks

Slot0

Liquidity

Observation
```

History Provider
```
Snapshots

Historical Blocks

Replay
```

Future
```
RPC

DefiLlama

Subgraph

Database

Archive Node

Local Cache
```
Core doesn't care.

---

### Protocol Adapter Interface
```
IProtocolAdapter

discoverPools()

getPoolState()

getPoolTicks()

simulatePosition()

quoteLiquidity()

normalizePool()
```
Every protocol implements it.

---

### History Provider Interface
```
IHistoryProvider

getSnapshots()

getBlock()

replayPool()

getPoolHistory()
```

---

### RPC Provider Interface

```
IRpcProvider

readContract()

multicall()

getBlock()

getLogs()

getBalance()
```
Only RPC provider uses viem.

---

### Recommendation Flow
```
Pool

↓

Current Price

↓

Generate Candidate Ranges

↓

Allocate Capital

↓

Estimate Fees

↓

Estimate IL

↓

Estimate APR

↓

Score

↓

Sort

↓

Return
```

Everything after "Current Price" belongs to Core.

---

### Candidate Generation
Never ask protocol.

Core generates.

**Example**
```
±2%

±5%

±10%

1σ

2σ

Current Tick Spacing

Custom

Adaptive
```
Future strategies simply implement
```
IRangeGenerator
```

---

### Recommendation Strategy
Everything becomes plugins.

```
IRecommendationStrategy
```

Examples

```
Balanced

Maximum Fee

Lowest Risk

Maximum Capital Efficiency

Highest Sharpe

AI Recommendation
```
Later AI becomes another strategy.

---

### Scoring
Every strategy returns
```
TRecommendation

{

score,

expectedFees,

estimatedIL,

capitalEfficiency,

apr,

risk,

range

}
```
The UI decides what to display.

---

### Simulation Levels
Keep them completely isolated.
```
simulation/

    deposit/

    futurePrice/

    historicalReplay/

    monteCarlo/
```

Each implements

```
ISimulation
```
Example
```
run(input): TResult
```
Nothing shared except interfaces.

---

### Analytics
This should own
```
Impermanent Loss

APR

APY

Fee Estimation

Capital Efficiency

Volatility

Sharpe

Drawdown

Exposure

Utilization
```
No protocol logic.

---

### Historical Replay
Version 1
```
RPC

↓

Historical Blocks

↓

Pool State

↓

Replay

↓

Metrics
```
Later

```
Database

↓

Snapshots

↓

Replay
```
Same interface.

---

### UI Flow

```
Choose Network

↓

Search Tokens

↓

Discover Pools

↓

Choose Pool

↓

Input Capital

↓

Recommendation

↓

Simulation

↓

Charts

↓

Compare Strategies
```
Wallet never required.

---

### Suggested Roadmap

#### Phase 0 — Foundation

Goal
  - Initialize Nuxt 4 with TypeScript.
  - Set up linting, formatting, testing, and path aliases.
  - Create the DDD folder structure.
  - Define shared types, interfaces, and error handling.
  - Establish dependency rules (Core must not import Nuxt, viem, or protocol SDKs).

Deliverables
  - Project skeleton.
  - Empty Core modules.
  - CI-ready project structure

---

#### Phase 1 — Protocol Infrastructure

Goal
  - Build provider and adapter foundations.

Implement
  - RPC Provider (using viem).
  - History Provider (RPC replay implementation).
  - Protocol adapter interfaces.
  - Network abstraction.
  - Protocol registry.

Deliverables
  - Read pool data from RPC.
  - Discover pools.
  - Retrieve live pool state.

---

#### Phase 2 — Uniswap V3 / Shadow Adapter

Goal
  - Implement the first concentrated-liquidity adapter.

Implement
  - Pool discovery.
  - Tick reading.
  - Tick math wrapper.
  - Liquidity calculations.
  - Price conversion.
  - SDK translation layer.

Deliverables
  - Protocol-neutral `TPoolState`.
  - Live pool information.

---

#### Phase 3 — Core Domain

Goal
  - Build all protocol-independent business models.

Implement
  - Pool.
  - Position.
  - Market.
  - Analytics.
  - Recommendation.
  - Strategy.
  - History.

Deliverables
  - Rich domain model.
  - No protocol dependencies

---

#### Phase 4 — Mathematical Engine

Goal
  - Implement the Core's mathematical models.

Implement
  - Impermanent loss.
  - APR estimation.
  - Capital efficiency.
  - Volatility estimation.
  - Sharpe-like score.
  - Candidate range generation.
  - Capital allocation.
  - Weighted scoring.

Deliverables
  - Complete reusable math engine.

---

#### Phase 5 — Simulation Engine

Goal
  - Develop independent simulation modules.

Levels
  1. Deposit simulation.
  2. Future price scenarios.
  3. Historical replay.
  4. Monte Carlo simulations.

Deliverables
  - Independent simulation framework.
  - Reusable simulation interfaces.

---

#### Phase 6 — Recommendation Engine

Goal
  - Generate, evaluate, and rank LP strategies.

Implement
  - Candidate generation.
  - Recommendation strategies.
  - Configurable scoring weights.
  - Strategy ranking.

Deliverables
  - Ranked LP recommendations.
  - Multiple optimization strategies.

---

#### Phase 7 — Application Layer

Goal
 - Coordinate domains into user-facing use cases.

Implement
  - Analyze selected pool.
  - Simulate position.
  - Compare strategies.
  - Replay historical performance.

Deliverables
  - Use cases returning UI-ready DTOs.

---

#### Phase 8 — Nuxt UI

Goal
  - Build the client-side interface.

Implement
  - Network selector.
  - Token search.
  - Pool discovery.
  - Pool details.
  - Recommendation view.
  - Simulation controls.
  - Charts.
  - Strategy comparison.

Deliverables
  - Fully client-side LP analytics application.

---

#### Phase 9 — Advanced Features

Goal
  - Extend the platform without changing the Core.

Potential additions
  - Additional DEX adapters (e.g., Shadow, Algebra, Pancake V3).
  - Alternative history providers (database, APIs).
  - Alternative price/history sources.
  - AI recommendation strategy.
  - Pool comparison across protocols.
  - User-defined optimization profiles.
  - Export and reporting.
  - Performance optimizations (workers, caching, IndexedDB).

---

#### Dependency Rules (Non-negotiable)

To keep the architecture clean and future-proof:
```
Nuxt UI
        ↓
Application
        ↓
Domains
        ↓
Math
        ↓
Shared

Adapters ───────► Providers

Application ────► Adapters

Application ────► Providers
```

Forbidden dependencies:
  - `Domains` → `Adapters`
  - `Domains` → `Providers`
  - `Domains` → `Nuxt`
  - `Domains` → `viem`
  - `Domains` → Protocol SDKs
  - `Math` → Adapters
  - `Math` → Providers
  - `Shared` → Any higher layer

This ensures the Core remains completely framework-agnostic, stateless, and portable to another runtime (such as Fastify or a worker) without modifying a single line of code.

##### What I would implement first

Given your goals and experience level, I'd follow this sequence:

Create the project skeleton and dependency boundaries.
Design the protocol-neutral domain model (`TPoolState`, `TPosition`, `TTickRange`, etc.).
Build the provider layer with `viem` (RPC and historical block replay).
Implement the Uniswap V3 adapter using the official SDK only as a translation layer.
Build the deposit simulation (Simulation Level 1).
Implement the recommendation engine and scoring model.
Add future price simulation, then historical replay, and finally Monte Carlo.

This order gives you a working end-to-end vertical slice early while preserving the long-term architecture needed to support additional DEX models such as Weighted Pools, StableSwap, and future hook-based protocols without redesigning the Core.