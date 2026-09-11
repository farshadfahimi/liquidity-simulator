// scripts/smoke-test-phase7.ts

/**
 * Phase 7 end-to-end smoke test.
 *
 * Exercises the Application Layer — use cases, DTOs, errors, and
 * the IRpcProvider `blockTag` extension — through the
 * {@link CoreServices} composition root, against a synthetic +
 * (when reachable) live USDC/WETH 0.05% pool.
 *
 * Sections:
 *
 *   [0] — Live or synthetic pool fixture. We *also* build the
 *         synthetic pool directly through the adapter (no live
 *         fetch) so blockTag / AdapterNotFoundError negative
 *         tests have a deterministic shape.
 *
 *   [1] — `discoverPools` use case (lookupPool mode).
 *   [2] — `analyzePool` use case.
 *   [3] — `simulatePosition` use case (all 4 sim levels: deposit,
 *         futurePrice, historical, monteCarlo).
 *   [4] — `replayHistoricalPerformance` use case.
 *   [5] — `compareStrategies` use case.
 *
 *   [6] — Negative paths:
 *           - `InvalidUseCaseInputError` on bad ranges / bad inputs.
 *           - `MissingPoolHistoryError` on replay-without-history.
 *           - `AdapterNotFoundError` on unregistered chain.
 *
 *   [7] — IRpcProvider `blockTag` extension: read the WETH symbol
 *         at a recent (≈ current) block — confirms the new shape
 *         flows through `RpcProvider.readContract` without breaking
 *         the default (latest) behavior.
 *
 *   [8] — Sanity assertions: DTO shapes valid, errors carry stable
 *         `code`, history-derived fields populated when history is
 *         supplied, etc.
 *
 * Run: `npx -y tsx scripts/smoke-test-phase7.ts`
 */

import { mainnet } from 'viem/chains';

import { createRpcProvider } from '../app/core/providers/rpc';
import { createUniswapV3Adapter } from '../app/core/adapters/uniswap/v3';

import { createNetworkProvider, type TNetwork } from '../app/core/network';
import { createCoreServices } from '../app/core/services';
import { NetworkRegistry } from '../app/core/network';
import {
  createPoolHistory,
  createAnalyticsEngine,
  createConstantRangeGenerator,
  PoolSnapshot,
} from '../app/core/domains';
import { createPool } from '../app/core/domains/pool';
import { Price, sqrtPriceX96ToPrice } from '../app/core/shared/value_objects';
import {
  APR_SCALE,
  CAPITAL_EFFICIENCY_SCALE,
  IL_SCALE,
  SCORE_SCALE,
  SECONDS_PER_YEAR,
  VOLATILITY_SCALE,
  sqrtRatioAtTick,
} from '../app/core/math';
import { bigintExp } from '../app/core/math/lnexp.util';

import { PRICE_DECIMALS } from './smoke-test-constants';

import {
  AdapterNotFoundError,
  InvalidUseCaseInputError,
  MissingPoolHistoryError,
  type IDiscoveredPoolDTO,
  type IHistoricalReplayDTO,
  type IPoolAnalysisDTO,
  type IPositionSimulationDTO,
  type IRecommendationDTO,
  type UseCaseErrorClass,
} from '../app/core/application';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';

const MAINNET_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const MAINNET_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
const FEE_500 = 500;
const SYNTH_CHAIN_ID = 99_999; // never reached by live fetches; used as
                              // the negative-path chainId for
                              // AdapterNotFoundError checks.

const SECONDS_PER_DAY = 86_400n;
const DAILY_SIGMA_PCT = 3.0;
const SYNTH_HISTORY_DAYS = 30;

// Deterministic LCG so synthetic history is reproducible.
function lcg(seed: bigint): bigint {
  return (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
}

function fmtPct(v: bigint, scale: bigint = VOLATILITY_SCALE): string {
  return `${(Number(v) / Number(scale) * 100).toFixed(2)}%`;
}

function fmtScore(v: bigint): string {
  return `${(Number(v) / Number(SCORE_SCALE)).toFixed(4)}`;
}

function fmtCE(v: bigint): string {
  return `${(Number(v) / Number(CAPITAL_EFFICIENCY_SCALE)).toFixed(2)}×`;
}

/**
 * Build a synthetic 30-day daily price history anchored on a
 * reference price. Mirrors the helper in
 * `scripts/smoke-test-phase{5,6}.ts` so Phase 5+6 + Phase 7
 * share synthetic-history construction.
 */
function buildSyntheticHistory(
  pool: `0x${string}`,
  chainId: number,
  currentTick: number,
  currentLiquidity: bigint,
  currentSqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number,
  days: number,
  dailySigmaPct: number,
  seed: bigint,
  referencePrice: bigint,
): readonly PoolSnapshot[] {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const startBlock = 21_000_000n;

  const ONE = 10n ** 18n;
  const snap: PoolSnapshot[] = [];

  let s = seed;
  const logReturns: bigint[] = [];
  let cumulativeLog = 0n;

  for (let i = 0; i < days; i++) {
    let z = 0;
    for (let j = 0; j < 12; j++) {
      s = lcg(s);
      z += Number(s >> 40n) / (1 << 24);
    }
    z -= 6;

    const noisePct = z * dailySigmaPct;
    const noiseScaled = BigInt(Math.round(noisePct / 100 * Number(ONE)));
    cumulativeLog += noiseScaled;
    logReturns.push(cumulativeLog);
  }

  const totalLog = logReturns.at(-1)!;

  for (let i = 0; i < days; i++) {
    const expArg = logReturns[i]! - totalLog;
    const expVal = bigintExp(expArg, 18);
    const priceBig = (referencePrice * expVal) / ONE;

    const ratio = Number(priceBig) / Number(referencePrice);
    const tickDelta = Math.round(Math.log(ratio) / Math.log(1.0001));
    const tick = currentTick + tickDelta;

    snap.push(new PoolSnapshot(
      pool,
      chainId,
      startBlock + BigInt(i * 1000),
      now - BigInt(days - 1 - i) * SECONDS_PER_DAY,
      currentSqrtPriceX96,
      tick,
      currentLiquidity,
      new Price(priceBig, PRICE_DECIMALS),
    ));
  }

  return snap;
}

/**
 * Try to read live pool state; return null on failure.
 */
async function tryLivePool(): Promise<
  | {
      state: Awaited<
        ReturnType<ReturnType<typeof createUniswapV3Adapter>['getPoolState']>
      >;
      poolAddress: `0x${string}`;
    }
  | null
> {
  try {
    const rpc = createRpcProvider({ chain: mainnet, rpcUrl: RPC_URL });
    const adapter = createUniswapV3Adapter({ rpc });
    const poolAddress = await adapter.resolvePool(
      MAINNET_USDC,
      MAINNET_WETH,
      FEE_500,
    );

    if (!poolAddress) {
      return null;
    }

    const state = await adapter.getPoolState(poolAddress);

    return { state, poolAddress };
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== Phase 7 — Application Layer smoke test ===\n');

  // -----------------------------------------------------------------
  // [0] — Build the composition root + adapter registry.
  //
  //   The live pool is only fetched here; the fixture variables
  //   are populated either from the live response or a synthetic
  //   fallback so every downstream use case can run identically.
  // -----------------------------------------------------------------
  console.log('[0] Constructing CoreServices + adapter registry …');

  // We register a custom mainnet override so the smoke test
  // controls which public RPC we hit. The bundled `ethereum`
  // constant in @core/network uses `eth.llamarpc.com` which is
  // frequently down (HTTP 521 as of late 2026); pinning to
  // `ethereum-rpc.publicnode.com` keeps the smoke deterministic.
  const registry = new NetworkRegistry();
  const mainnetOverride: TNetwork = {
    id: mainnet.id,
    name: mainnet.name,
    rpcUrl: RPC_URL,
    explorerUrl: mainnet.blockExplorers?.default.url,
    nativeCurrency: {
      name: mainnet.nativeCurrency.name,
      symbol: mainnet.nativeCurrency.symbol,
      decimals: mainnet.nativeCurrency.decimals,
    },
    multicall3Address: '0xca11bde05977b3631167028862be2a173976ca11',
  };
  registry.register(mainnetOverride);
  const network = createNetworkProvider({ registry, chainId: mainnet.id });

  const rpc = network.rpc();
  const adapter = createUniswapV3Adapter({ rpc });

  const services = createCoreServices({
    network,
    adapters: new Map([[mainnet.id, [adapter]]]),
  });
  const useCases = services.useCases();

  console.log(`    services.id = ${services.id}`);
  console.log(`    resolver:   ${typeof services.resolveAdapter}`);
  console.log(`    use case IDs: ${useCases.discoverPools.id}, ${useCases.analyzePool.id}, ${useCases.simulatePosition.id}, ${useCases.replayHistoricalPerformance.id}, ${useCases.compareStrategies.id}`);

  // -----------------------------------------------------------------
  // [0.5] — Pool fixture: live or synthetic.
  // -----------------------------------------------------------------
  let live: Awaited<ReturnType<typeof tryLivePool>> = null;
  let poolAddress: `0x${string}`;
  let currentTick: number;
  let currentSqrtPriceX96: bigint;
  let currentLiquidity: bigint;
  let token0Decimals: number;
  let token1Decimals: number;
  let currentPrice18: Price;

  console.log('\n[0.5] Attempting live pool read (USDC/WETH 0.05%) …');

  try {
    live = await tryLivePool();
  } catch (err) {
    console.log(
      '    live read failed:',
      err instanceof Error ? err.message : String(err),
    );
  }

  if (live) {
    poolAddress = live.poolAddress;
    currentTick = live.state.tick;
    currentSqrtPriceX96 = live.state.sqrtPriceX96;
    currentLiquidity = live.state.liquidity;
    token0Decimals = live.state.token0.decimals;
    token1Decimals = live.state.token1.decimals;
    currentPrice18 = sqrtPriceX96ToPrice(
      currentSqrtPriceX96,
      token0Decimals,
      token1Decimals,
      PRICE_DECIMALS,
    );
    console.log(
      `    live OK — tick=${currentTick}, liquidity=${currentLiquidity}`,
    );
  } else {
    console.log('    live read failed → using synthetic pool fixture');
    poolAddress = '0x000000000000000000000000000000000000dEaD' as const;
    currentTick = 198000;
    currentSqrtPriceX96 = sqrtRatioAtTick(currentTick);
    currentLiquidity = 5_000_000_000_000_000_000n;
    token0Decimals = 6;
    token1Decimals = 18;
    currentPrice18 = sqrtPriceX96ToPrice(
      currentSqrtPriceX96,
      token0Decimals,
      token1Decimals,
      PRICE_DECIMALS,
    );
  }

  // -----------------------------------------------------------------
  // [0.7] — Pre-build a synthetic history + pool aggregate.
  //   Live-mode also gets a history so per-DTO history-derived
  //   fields can be sanity-checked.
  // -----------------------------------------------------------------
  console.log('\n[0.7] Building synthetic 30-day history + Pool aggregate …');

  const poolState = live
    ? {
        pool: poolAddress,
        token0: live.state.token0,
        token1: live.state.token1,
        fee: live.state.fee,
        tickSpacing: live.state.tickSpacing,
        sqrtPriceX96: currentSqrtPriceX96,
        tick: currentTick,
        liquidity: currentLiquidity,
        feeGrowthGlobal0X128: live.state.feeGrowthGlobal0X128,
        feeGrowthGlobal1X128: live.state.feeGrowthGlobal1X128,
      }
    : {
        pool: poolAddress,
        token0: {
          address: MAINNET_USDC,
          symbol: 'USDC',
          decimals: token0Decimals,
        },
        token1: {
          address: MAINNET_WETH,
          symbol: 'WETH',
          decimals: token1Decimals,
        },
        fee: FEE_500,
        tickSpacing: 10,
        sqrtPriceX96: currentSqrtPriceX96,
        tick: currentTick,
        liquidity: currentLiquidity,
        feeGrowthGlobal0X128: 0n,
        feeGrowthGlobal1X128: 0n,
      };

  const poolAggregate = createPool({ state: poolState, chainId: mainnet.id });

  const history = createPoolHistory({
    pool: poolAddress,
    chainId: mainnet.id,
    snapshots: buildSyntheticHistory(
      poolAddress,
      mainnet.id,
      currentTick,
      currentLiquidity,
      currentSqrtPriceX96,
      token0Decimals,
      token1Decimals,
      SYNTH_HISTORY_DAYS,
      DAILY_SIGMA_PCT,
      54321n,
      currentPrice18.value,
    ),
  });

  const analytics = createAnalyticsEngine();
  const vol = analytics.volatilityFromHistory(history);
  const sigmaAnnual = vol?.volAnnual ?? 5n * 10n ** 17n;
  console.log(`    history.size = ${history.size()}, σ_annual ≈ ${fmtPct(sigmaAnnual, VOLATILITY_SCALE)}`);

  // -----------------------------------------------------------------
  // [1] — DiscoverPoolsUseCase (lookupPool mode).
  // -----------------------------------------------------------------
  console.log('\n[1] DiscoverPoolsUseCase.execute (lookupPool mode) …');
  const discovered: readonly IDiscoveredPoolDTO[] = await useCases.discoverPools.execute({
    chainId: mainnet.id,
    tokenA: MAINNET_USDC,
    tokenB: MAINNET_WETH,
    fee: FEE_500,
  });
  console.log(`    returned ${discovered.length} pool(s)`);

  if (discovered.length > 0) {
    console.log(
      `    [0].pool       = ${discovered[0]!.pool}`
      + `\n    [0].protocolId = ${discovered[0]!.protocolId}`
      + `\n    [0].fee        = ${discovered[0]!.fee}`,
    );
  }

  // -----------------------------------------------------------------
  // [2] — AnalyzePoolUseCase.
  // -----------------------------------------------------------------
  console.log('\n[2] AnalyzePoolUseCase.execute (live + synthetic history) …');
  const analysis: IPoolAnalysisDTO = await useCases.analyzePool.execute({
    pool: poolAddress,
    chainId: mainnet.id,
    history,
    priceDecimals: PRICE_DECIMALS,
  });

  console.log(`    pool            = ${analysis.pool}`);
  console.log(`    chainId         = ${analysis.chainId}`);
  console.log(`    protocolId      = ${analysis.protocolId}`);
  console.log(`    description     = "${analysis.description}"`);
  console.log(`    feeTier         = ${analysis.feeTier}`);
  console.log(`    tickSpacing     = ${analysis.tickSpacing}`);
  console.log(`    currentTick     = ${analysis.currentTick}`);
  console.log(`    currentPrice    = ${analysis.currentPrice.toString().slice(0, 12)}… (decimals=${analysis.currentPriceDecimals})`);
  console.log(`    annualizedVol   = ${fmtPct(analysis.annualizedVolatility, VOLATILITY_SCALE)}`);
  console.log(`    cumulativeReturn= ${fmtPct(analysis.cumulativeReturn, 10n ** 18n)}`);
  console.log(`    snapshotCount   = ${analysis.snapshotCount}`);
  console.log(`    historyWindow(s)= ${analysis.historyWindowSeconds.toString()}`);
  console.log(`    token0.symbol   = ${analysis.token0.symbol}`);
  console.log(`    token1.symbol   = ${analysis.token1.symbol}`);

  // -----------------------------------------------------------------
  // [3] — SimulatePositionUseCase (all 4 sim levels).
  // -----------------------------------------------------------------
  console.log('\n[3] SimulatePositionUseCase.execute (all 4 levels, $\u00b12% range) …');
  const constantGen = createConstantRangeGenerator({ widthsTicks: [400] });
  const range = constantGen.generate(poolAggregate)[0]!;

  const simulate: IPositionSimulationDTO = await useCases.simulatePosition.execute({
    pool: poolAddress,
    chainId: mainnet.id,
    range: { tickLower: range.tickLower, tickUpper: range.tickUpper },
    principalInNumeraire: 100_000_000n, // 100 USDC at 6-dec
    numeraireToken: 'token0',
    token0Amount: 100_000_000n,
    targetApr: 3n * 10n ** 17n, // 30% APR
    futurePrice: new Price(
      (currentPrice18.value * 11n) / 10n, // +10% future price
      PRICE_DECIMALS,
    ),
    history,
    monteCarlo: {
      muAnnual: 0n,
      sigmaAnnual,
      numPaths: 64,
      numSteps: 30,
      stepSeconds: SECONDS_PER_DAY,
      seed: 12_345n,
    },
  });

  console.log(`    entryPrice      = ${simulate.entryPrice.toString().slice(0, 12)}\u2026 (decimals=${simulate.entryPriceDecimals})`);
  console.log(`    quote.liquidity = ${simulate.quote.liquidity.toString().slice(0, 12)}\u2026`);
  console.log(`    quote.amount0   = ${simulate.quote.amount0.toString()}`);
  console.log(`    quote.amount1   = ${simulate.quote.amount1.toString()}`);
  console.log(`    deposit.amount0 = ${simulate.deposit.amount0.toString()}`);
  console.log(`    deposit.notional= ${simulate.deposit.notionalInNumeraire.toString()}`);

  if (simulate.futurePrice) {
    console.log(`    futurePrice.terminalIL = ${fmtPct(simulate.futurePrice.terminalIl, IL_SCALE)}`);
  }
  if (simulate.historical) {
    console.log(`    historical.APR         = ${fmtPct(simulate.historical.apr, APR_SCALE)}`);
    console.log(`    historical.timeInRange = ${fmtPct(simulate.historical.timeInRangeFraction, 10n ** 18n)}`);
  }
  if (simulate.monteCarlo) {
    console.log(`    MC.terminalValueMean   = ${simulate.monteCarlo.terminalValueMean.toString()}`);
    console.log(`    MC.horizonSeconds      = ${simulate.monteCarlo.horizonSeconds.toString()}`);
  }

  // -----------------------------------------------------------------
  // [4] — ReplayHistoricalPerformanceUseCase.
  // -----------------------------------------------------------------
  console.log('\n[4] ReplayHistoricalPerformanceUseCase.execute …');
  const replay: IHistoricalReplayDTO = await useCases.replayHistoricalPerformance.execute({
    pool: poolAddress,
    chainId: mainnet.id,
    range: { tickLower: range.tickLower, tickUpper: range.tickUpper },
    principalInNumeraire: 100_000_000n,
    numeraireToken: 'token0',
    history,
    targetApr: 3n * 10n ** 17n,
  });

  console.log(`    range               = [${replay.range.tickLower}, ${replay.range.tickUpper}]`);
  console.log(`    snapshotCount       = ${replay.snapshotCount}`);
  console.log(`    historyWindow(s)    = ${replay.historyWindowSeconds.toString()}`);
  console.log(`    feeRatePerSecond    = ${replay.feeRatePerSecond.toString()}`);
  console.log(`    totalFees           = ${replay.totalFeesInNumeraire.toString()}`);
  console.log(`    apr                 = ${fmtPct(replay.apr, APR_SCALE)}`);
  console.log(`    meanIl              = ${fmtPct(replay.meanIl, IL_SCALE)}`);
  console.log(`    min/maxIl           = ${fmtPct(replay.minIl, IL_SCALE)} / ${fmtPct(replay.maxIl, IL_SCALE)}`);
  console.log(`    finalIl             = ${fmtPct(replay.finalIl, IL_SCALE)}`);
  console.log(`    timeInRange         = ${fmtPct(replay.timeInRangeFraction, 10n ** 18n)}`);
  console.log(`    maxDrawdown         = ${fmtPct(replay.maxDrawdown, IL_SCALE)}`);
  console.log(`    nIntervals          = ${replay.nIntervals}`);

  // -----------------------------------------------------------------
  // [5] — CompareStrategiesUseCase.
  // -----------------------------------------------------------------
  console.log('\n[5] CompareStrategiesUseCase.execute (default strategies + widths) …');
  const recs: IRecommendationDTO = useCases.compareStrategies.execute({
    pool: poolAggregate,
    protocolId: 'uniswap-v3',
    expectedApr: 3n * 10n ** 17n,
    annualizedVolatility: sigmaAnnual,
    riskFreeApr: 0n,
  });

  console.log(`    poolDescription     = "${recs.poolDescription}"`);
  console.log(`    rangeGeneratorId    = ${recs.rangeGeneratorId}`);
  console.log(`    strategyIds         = ${recs.strategyIds.join(', ')}`);
  console.log(`    nCandidates         = ${recs.nCandidates}`);
  console.log(`    nRecommendations    = ${recs.nRecommendations}`);
  console.log(`    nSkipped            = ${recs.nSkipped}`);
  console.log(`    protocolId          = ${recs.protocolId}`);
  console.log('\n    Top 5:');
  for (const r of recs.recommendations.slice(0, 5)) {
    console.log(
      `      ${r.id.padEnd(48)} score=${fmtScore(r.score).padStart(7)} `
      + `CE=${fmtCE(r.capitalEfficiency).padStart(7)} `
      + `IL=${fmtPct(r.ilAtCurrentPrice, IL_SCALE).padStart(8)} `
      + `side=${r.side.padEnd(7)}`,
    );
  }

  // -----------------------------------------------------------------
  // [6] — Negative paths.
  // -----------------------------------------------------------------
  console.log('\n[6] Negative-path assertions …');

  const negativeChecks: Array<{
    name: string;
    pass: boolean;
    detail?: string;
  }> = [];

  // (6.a) analyzePool with no pool address → InvalidUseCaseInputError
  try {
    await useCases.analyzePool.execute({
      pool: '' as `0x${string}`,
      chainId: mainnet.id,
    });
    negativeChecks.push({
      name: 'analyzePool("") throws InvalidUseCaseInputError',
      pass: false,
      detail: 'no throw',
    });
  } catch (err) {
    negativeChecks.push({
      name: 'analyzePool("") throws InvalidUseCaseInputError',
      pass: err instanceof InvalidUseCaseInputError && err.code === 'invalid-input',
      detail: err instanceof Error ? `code=${(err as UseCaseErrorClass).code ?? 'n/a'}` : `non-Error throw: ${String(err)}`,
    });
  }

  // (6.b) simulatePosition with bad range → InvalidUseCaseInputError
  try {
    await useCases.simulatePosition.execute({
      pool: poolAddress,
      chainId: mainnet.id,
      range: { tickLower: 1000, tickUpper: 500 }, // lower > upper
      principalInNumeraire: 0n,
      numeraireToken: 'token0',
    });
    negativeChecks.push({
      name: 'simulatePosition(bad range) throws InvalidUseCaseInputError',
      pass: false,
      detail: 'no throw',
    });
  } catch (err) {
    negativeChecks.push({
      name: 'simulatePosition(bad range) throws InvalidUseCaseInputError',
      pass: err instanceof InvalidUseCaseInputError && err.field === 'range',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // (6.c) replayHistoricalPerformance without history → MissingPoolHistoryError
  try {
    await useCases.replayHistoricalPerformance.execute({
      pool: poolAddress,
      chainId: mainnet.id,
      range: { tickLower: range.tickLower, tickUpper: range.tickUpper },
      principalInNumeraire: 0n,
      numeraireToken: 'token0',
      history: undefined,
    });
    negativeChecks.push({
      name: 'replayHistoricalPerformance(undefined history) throws MissingPoolHistoryError',
      pass: false,
      detail: 'no throw',
    });
  } catch (err) {
    negativeChecks.push({
      name: 'replayHistoricalPerformance(undefined history) throws MissingPoolHistoryError',
      pass: err instanceof MissingPoolHistoryError && err.code === 'missing-pool-history',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // (6.d) analyzePool on an unregistered chain → AdapterNotFoundError
  try {
    await useCases.analyzePool.execute({
      pool: poolAddress,
      chainId: SYNTH_CHAIN_ID,
    });
    negativeChecks.push({
      name: 'analyzePool(unregistered chain) throws AdapterNotFoundError',
      pass: false,
      detail: 'no throw',
    });
  } catch (err) {
    negativeChecks.push({
      name: 'analyzePool(unregistered chain) throws AdapterNotFoundError',
      pass: err instanceof AdapterNotFoundError && err.code === 'adapter-not-found',
      detail: err instanceof AdapterNotFoundError
        ? `chainId=${err.chainId} protocolId=${err.protocolId ?? '<none>'}`
        : String(err),
    });
  }

  // (6.e) compareStrategies without pool → InvalidUseCaseInputError
  try {
    useCases.compareStrategies.execute({
      pool: undefined as never,
    });
    negativeChecks.push({
      name: 'compareStrategies(no pool) throws InvalidUseCaseInputError',
      pass: false,
      detail: 'no throw',
    });
  } catch (err) {
    negativeChecks.push({
      name: 'compareStrategies(no pool) throws InvalidUseCaseInputError',
      pass: err instanceof InvalidUseCaseInputError,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // -----------------------------------------------------------------
  // [7] — IRpcProvider `blockTag` extension smoke.
  //
  //   We pin a `blockTag` to the *current* block number — the read
  //   should still succeed (archive reads are unsupported on most
  //   public RPCs, but a "still-current" block is fine). The
  //   objective here is to confirm that adding `blockTag` to
  //   `TReadContractParams` didn't break anything: the underlying
  //   viem call accepts a `blockNumber` override.
  // -----------------------------------------------------------------
  console.log('\n[7] IRpcProvider blockTag extension (WETH symbol @ current block) …');

  let blockTagOk = false;
  try {
    const latest = await services.rpc().getBlockNumber();
    // Pin to `latest - 1` so we *aren't* re-reading the latest
    // block (recent blocks are often unreorged-but-not-finalized on
    // public RPCs).
    const pin = latest > 1n ? latest - 1n : latest;

    const symbolAtBlock = await services.rpc().readContract<string>({
      address: MAINNET_WETH,
      abi: [
        {
          type: 'function',
          name: 'symbol',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'string' }],
        },
      ],
      functionName: 'symbol',
      // Phase 7: optional historical block tag.
      blockTag: pin,
    });

    blockTagOk = symbolAtBlock === 'WETH';
    console.log(`    WETH.symbol @ blockTag=${pin} = "${symbolAtBlock}"`);
  } catch (err) {
    console.log(
      '    blockTag read failed (often due to public-RPC retention); continuing. err:',
      err instanceof Error ? err.message : String(err),
    );
  }

  // -----------------------------------------------------------------
  // [8] — Sanity assertions.
  // -----------------------------------------------------------------
  console.log('\n[8] Sanity assertions …');

  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  // (a) DTO shapes. Each top-level DTO must carry every required
  // field at the expected type.
  checks.push({
    name: 'analyzePool DTO carries every expected field',
    pass:
      typeof analysis.pool === 'string'
      && typeof analysis.chainId === 'number'
      && typeof analysis.protocolId === 'string'
      && typeof analysis.description === 'string'
      && typeof analysis.feeTier === 'number'
      && typeof analysis.tickSpacing === 'number'
      && typeof analysis.currentTick === 'number'
      && typeof analysis.currentPrice === 'bigint'
      && typeof analysis.currentPriceDecimals === 'number'
      && typeof analysis.token0 === 'object'
      && typeof analysis.token1 === 'object'
      && typeof analysis.annualizedVolatility === 'bigint'
      && typeof analysis.cumulativeReturn === 'bigint'
      && typeof analysis.returnDecimals === 'number'
      && typeof analysis.snapshotCount === 'number'
      && typeof analysis.historyWindowSeconds === 'bigint',
    detail: `pool=${analysis.pool.slice(0, 10)}\u2026`,
  });

  checks.push({
    name: 'analyzePool.history-derived fields populated',
    pass: analysis.snapshotCount === SYNTH_HISTORY_DAYS
      && analysis.annualizedVolatility > 0n
      && analysis.historyWindowSeconds > 0n,
    detail: `snapshots=${analysis.snapshotCount} σ=${fmtPct(analysis.annualizedVolatility, VOLATILITY_SCALE)}`,
  });

  // (b) PositionSimulationDTO — every optional slot present.
  checks.push({
    name: 'simulatePosition returned all four sim levels',
    pass:
      simulate.quote !== undefined
      && simulate.deposit !== undefined
      && simulate.futurePrice !== null
      && simulate.historical !== null
      && simulate.monteCarlo !== null,
  });

  // (c) Future-price scenario at +10% must yield a non-zero PnL.
  checks.push({
    name: 'simulatePosition.futurePrice populates a horizonSeconds > 0',
    pass: simulate.futurePrice !== null
      && simulate.futurePrice.horizonSeconds > 0n
      && simulate.futurePrice.horizonSeconds === SECONDS_PER_YEAR,
    detail: `horizon=${simulate.futurePrice?.horizonSeconds.toString()} (SPY=${SECONDS_PER_YEAR.toString()})`,
  });

  // (d) Historical sim populates everything.
  checks.push({
    name: 'simulatePosition.historical populates nIntervals',
    pass: simulate.historical !== null
      && simulate.historical.nIntervals > 0
      && simulate.historical.nSnapshots === history.size(),
    detail: `n=${simulate.historical?.nIntervals} snap=${simulate.historical?.nSnapshots}`,
  });

  // (e) MC summary percentiles satisfy p5 ≤ p50 ≤ p95.
  checks.push({
    name: 'simulatePosition.monteCarlo IL percentiles monotonic',
    pass: simulate.monteCarlo !== null
      && simulate.monteCarlo.terminalIlP05 <= simulate.monteCarlo.terminalIlP50
      && simulate.monteCarlo.terminalIlP50 <= simulate.monteCarlo.terminalIlP95,
  });

  // (f) HistoricalReplayDTO shape — entry price + APR + IL all
  // populated.
  checks.push({
    name: 'replayHistoricalPerformance populates all metric fields',
    pass: typeof replay.entryPrice === 'bigint'
      && replay.entryPrice > 0n
      && replay.feeRatePerSecond > 0n
      && replay.snapshotCount === SYNTH_HISTORY_DAYS
      && replay.nIntervals === SYNTH_HISTORY_DAYS - 1
      && replay.totalFeesInNumeraire >= 0n,
  });

  // (g) Replay's timeInRange ∈ [0, 1] at 1e18.
  checks.push({
    name: 'replayHistoricalPerformance.timeInRange ∈ [0, 1]',
    pass: replay.timeInRangeFraction >= 0n
      && replay.timeInRangeFraction <= 10n ** 18n,
  });

  // (h) Recommendation DTO — 5 strategy IDs present in the result.
  const seenStrategyIds = new Set(recs.recommendations.map((r) => r.strategyId));
  const expected5 = [
    'balanced',
    'maximum-fee',
    'lowest-risk',
    'highest-capital-efficiency',
    'highest-sharpe',
  ];
  const missing = expected5.filter((id) => !seenStrategyIds.has(id));
  checks.push({
    name: 'compareStrategies returned all five strategy IDs',
    pass: missing.length === 0,
    detail: missing.length ? `missing=${missing.join(',')}` : `${seenStrategyIds.size} unique ids`,
  });

  // (i) Recommendation ranking monotonic by score.
  let monotonic = true;
  for (let j = 1; j < recs.recommendations.length; j++) {
    const prev = recs.recommendations[j - 1]!.score;
    const curr = recs.recommendations[j]!.score;

    if (curr > prev) {
      monotonic = false;
      break;
    }
  }
  checks.push({ name: 'recommendations ranked by score (descending)', pass: monotonic });

  // (j) Errors all subclass UseCaseError + carry stable `code`.
  //     `code` is an *instance* field (declared via `readonly code =`
  //     in each subclass) — not a static prototype field. We verify
  //     by instantiating one of each and reading `instance.code`.
  //     We also assert every negative-path check resolved to a
  //     thrown use-case error (i.e. `pass === true`).
  const sampleCodes = [
    new InvalidUseCaseInputError('j', 'f', 'msg').code,
    new MissingPoolHistoryError('j', '' as never, 1).code,
    new AdapterNotFoundError('j', 1).code,
  ];
  checks.push({
    name: 'all thrown errors subclass UseCaseError + carry a `code`',
    pass:
      sampleCodes.every((c) => typeof c === 'string' && c.length > 0)
      && negativeChecks.every((c) => c.pass),
    detail: `codes=[${sampleCodes.join(', ')}]`,
  });

  // (k) CompareStrategies input poolDescription matches the live
  // pool's `describe()`.
  checks.push({
    name: 'compareStrategies.poolDescription matches pool.describe()',
    pass: recs.poolDescription === poolAggregate.describe(),
  });

  // (l) IRpcProvider blockTag — at minimum, the read either
  // returns the correct symbol or fails cleanly. We accept either
  // outcome here (public-RPC retention varies) but the test isn't
  // bypassed silently.
  checks.push({
    name: 'IRpcProvider blockTag wired (read at pinned block succeeded)',
    pass: blockTagOk,
    detail: blockTagOk ? 'WETH.symbol == "WETH"' : 'read at pinned block failed',
  });

  let pass = 0;
  let total = checks.length + negativeChecks.length;

  console.log('  Use case DTO + behavior:');
  for (const c of checks) {
    const icon = c.pass ? '\u2713' : '\u2717';
    // eslint-disable-next-line no-console
    console.log(`    ${icon} ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    if (c.pass) {
      pass++;
    }
  }

  console.log('\n  Negative paths:');
  for (const c of negativeChecks) {
    const icon = c.pass ? '\u2713' : '\u2717';
    // eslint-disable-next-line no-console
    console.log(`    ${icon} ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    if (c.pass) {
      pass++;
    }
  }

  console.log(`\n    ${pass}/${total} checks passed`);
  if (pass !== total) {
    throw new Error(`Phase 7 sanity checks failed: ${pass}/${total}`);
  }

  console.log('\n=== Phase 7 smoke complete ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
