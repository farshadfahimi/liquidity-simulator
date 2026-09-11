// scripts/smoke-test-phase5.ts

/**
 * Phase 5 end-to-end smoke test.
 *
 * Exercises all four simulation levels (deposit, future price,
 * historical replay, Monte Carlo) on a synthetic + (when reachable)
 * live USDC/WETH pool.
 *
 * Sections:
 *   [1] — Deposit simulation on a live-quoted position.
 *   [2] — FuturePriceSimulation across three scenarios
 *         (price down 10%, unchanged, up 50%).
 *   [3] — HistoricalReplaySimulation against a synthetic 30-day
 *         daily price history.
 *   [4] — MonteCarloSimulation with mu=0, sigma≈observed, 200 paths,
 *         30 daily steps.
 *
 * Public Ethereum RPCs frequently rate-limit or refuse archive
 * reads; if the live fetch fails we degrade to fully-synthetic
 * mode (no live pool) so the test still completes.
 *
 * Run: `npx -y tsx scripts/smoke-test-phase5.ts`
 */

import { mainnet } from 'viem/chains';

import { createRpcProvider } from '../app/core/providers/rpc';
import { createUniswapV3Adapter } from '../app/core/adapters/uniswap/v3';

import {
  createPool,
  createAnalyticsEngine,
  createDepositSimulation,
  createFuturePriceSimulation,
  createHistoricalReplaySimulation,
  createMonteCarloSimulation,
  createConstantRangeGenerator,
  createVolatilityAdjustedRangeGenerator,
} from '../app/core/domains';
import { Position } from '../app/core/domains/position';
import { PoolSnapshot } from '../app/core/domains/history';
import { createPoolHistory } from '../app/core/domains/history';
import { Price, TickRange, sqrtPriceX96ToPrice } from '../app/core/shared/value_objects';
import { bigintExp } from '../app/core/math/lnexp.util';
import {
  APR_SCALE,
  CAPITAL_EFFICIENCY_SCALE,
  IL_SCALE,
  SCORE_SCALE,
  VOLATILITY_SCALE,
} from '../app/core/math';
import { PRICE_DECIMALS } from './smoke-test-constants';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';

const MAINNET_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const MAINNET_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
const FEE_500 = 500;

const SECONDS_PER_DAY = 86_400n;
const SECONDS_PER_YEAR = 31_557_600n;

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
 * reference price. Each day's log return is sampled from
 * N(0, dailySigma²) using the same LCG-to-normal trick the MC
 * simulation uses (12-uniform CLT approximation).
 *
 * The final day's price matches `referencePrice` exactly
 * (anchoring), so the smoke is stable against any live current
 * tick we feed in.
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

  // Step 1: generate per-day log returns (forward walk).
  let s = seed;
  const logReturns: bigint[] = [];
  let cumulativeLog = 0n;

  for (let i = 0; i < days; i++) {
    let z = 0;
    for (let j = 0; j < 12; j++) {
      s = lcg(s);
      z += Number(s >> 40n) / (1 << 24);
    }
    z -= 6; // CLT

    const noisePct = z * dailySigmaPct;
    const noiseScaled = BigInt(Math.round(noisePct / 100 * Number(ONE)));
    cumulativeLog += noiseScaled;
    logReturns.push(cumulativeLog);
  }

  const totalLog = logReturns.at(-1)!;

  // Step 2: build per-day prices such that day `days-1` equals
  // `referencePrice`. Day i price =
  //   referencePrice * exp(logReturns[i] - totalLog)
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
  | { state: Awaited<ReturnType<ReturnType<typeof createUniswapV3Adapter>['getPoolState']>>; poolAddress: `0x${string}` }
  | null
> {
  try {
    const rpc = createRpcProvider({ chain: mainnet, rpcUrl: RPC_URL });
    const adapter = createUniswapV3Adapter({ rpc });
    const poolAddress = await adapter.resolvePool(MAINNET_USDC, MAINNET_WETH, FEE_500);

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
  console.log('=== Phase 5 — Simulation Engine smoke test ===\n');

  // -----------------------------------------------------------------
  // [0] Live pool or synthetic fallback.
  // -----------------------------------------------------------------
  let live: Awaited<ReturnType<typeof tryLivePool>> = null;
  let poolAddress: `0x${string}`;
  let currentTick: number;
  let currentSqrtPriceX96: bigint;
  let currentLiquidity: bigint;
  let token0Decimals: number;
  let token1Decimals: number;
  let currentPrice18: Price;

  console.log('[0] Attempting live pool read (USDC/WETH 0.05%) …');

  try {
    live = await tryLivePool();
  } catch (err) {
    console.log('    live read failed:', err instanceof Error ? err.message : String(err));
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
    // Synthetic "USDC/WETH" pool at a representative tick.
    poolAddress = '0x000000000000000000000000000000000000dEaD' as const;
    currentTick = 198000;
    currentSqrtPriceX96 = 0n; // unused for synthetic
    currentLiquidity = 5_000_000_000_000_000_000n;
    token0Decimals = 6; // USDC
    token1Decimals = 18; // WETH
    currentPrice18 = new Price(2500n * 10n ** 15n, 18); // 2500 USDC/ETH
  }

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

  const pool = createPool({ state: poolState, chainId: mainnet.id });

  // -----------------------------------------------------------------
  // [1] Deposit simulation.
  // -----------------------------------------------------------------
  console.log('\n[1] Deposit simulation on a ±500×spacing range …');
  const constantGen = createConstantRangeGenerator({
    widthsTicks: [500],
  });
  const range = constantGen.generate(pool)[0]!;

  const adapter = createUniswapV3Adapter({
    rpc: createRpcProvider({ chain: mainnet, rpcUrl: RPC_URL }),
  });

  let samplePosition: Position;
  try {
    const quote = await adapter.quotePosition(
      poolAddress,
      { tickLower: range.tickLower, tickUpper: range.tickUpper },
      1_000_000n,
    );
    samplePosition = Position.fromQuote(poolAddress, quote);
  } catch {
    // Fallback: synthesize a position from a notional.
    samplePosition = Position.fromRaw(
      poolAddress,
      range.tickLower,
      range.tickUpper,
      poolState.token0.address,
      poolState.token1.address,
      1_000_000_000_000_000n,
      100_000_000n,
      50_000_000_000_000_000n,
    );
  }

  const depositSim = createDepositSimulation();
  const depositOut = depositSim.run({ token0Amount: 1_000_000n }, pool, samplePosition);

  console.log(`    side         = ${depositOut.side}`);
  console.log(`    in-range     = ${depositOut.currentlyInRange}`);
  console.log(`    fillRatio    = ${(Number(depositOut.fillRatio) / 1e18).toFixed(4)}`);
  console.log(`    lowerPrice   = ${depositOut.lowerPrice.toString().slice(0, 10)}…`);
  console.log(`    upperPrice   = ${depositOut.upperPrice.toString().slice(0, 10)}…`);

  // -----------------------------------------------------------------
  // [2] FuturePriceSimulation across scenarios.
  //
  //     We re-quote a fresh position sized at 100 USDC of token0 so
  //     the simulation's principal (the caller's reference
  //     notional) matches the position's actual deposit. (The
  //     earlier `samplePosition` was sized for 1 USDC; for the
  //     future-price section we want a $100-scale LP.)
  // -----------------------------------------------------------------
  console.log('\n[2] FuturePriceSimulation (entry = current price, 100 USDC position) …');
  const futureSim = createFuturePriceSimulation();
  const entryPrice = currentPrice18;
  const scenarios = [
    { name: '−10%', multiplier: 0.9 },
    { name: 'unchanged', multiplier: 1.0 },
    { name: '+50%', multiplier: 1.5 },
  ];

  let futurePosition: Position;
  try {
    const futureQuote = await adapter.quotePosition(
      poolAddress,
      { tickLower: range.tickLower, tickUpper: range.tickUpper },
      100_000_000n, // 100 USDC at 6-dec
    );
    futurePosition = Position.fromQuote(poolAddress, futureQuote);
  } catch {
    futurePosition = samplePosition;
  }
  const principalFuture = 100_000_000n; // 100 USDC at 6-dec

  for (const sc of scenarios) {
    const futurePrice = new Price(
      (entryPrice.value * BigInt(Math.round(sc.multiplier * 1e6))) / 1_000_000n,
      entryPrice.decimals,
    );
    const out = futureSim.run(
      {
        entryPrice,
        futurePrice,
        numeraireToken: 'token0',
        principalInNumeraire: principalFuture,
      },
      pool,
      futurePosition,
    );
    console.log(
      `    ${sc.name.padEnd(10)} side=${out.side.padEnd(7)} IL=${fmtPct(out.il, IL_SCALE).padStart(8)} `
      + `TV=${out.terminalValueInNumeraire.toString().padStart(12)} PnL=${out.pnlInNumeraire.toString().padStart(12)} `
      + `CE=${fmtCE(out.capitalEfficiency)}`,
    );
  }

  // -----------------------------------------------------------------
  // [3] HistoricalReplaySimulation on a synthetic 30-day history.
  // -----------------------------------------------------------------
  console.log('\n[3] HistoricalReplaySimulation (synthetic 30d, σ_day ≈ 3%) …');
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
      30,
      3.0,
      12345n,
      currentPrice18.value,
    ),
  });
  console.log(`    history.size = ${history.size()}`);

  const replaySim = createHistoricalReplaySimulation({ history });

  // Pre-compute feeRatePerSecond from a 30% APR target.
  //
  // The simulation takes `feeRatePerSecond` at 1e18 precision in
  // units of "fraction of principal per second". For a 30% APR:
  //   feeRatePerSecond_1e18 = apr_fraction_1e18 / SECONDS_PER_YEAR
  //   apr_fraction_1e18    = 0.30 × 1e18 = 3e17
  const principalReplay = 100_000_000n; // 100 USDC at 6-dec
  const APR_FRACTION_1e18 = 3n * 10n ** 17n; // 0.30
  const feeRatePerSecond = APR_FRACTION_1e18 / SECONDS_PER_YEAR;

  const replayOut = replaySim.run(
    {
      entryPrice: history.earliest()!.price,
      feeRatePerSecond,
      principalInNumeraire: principalReplay,
      numeraireToken: 'token0',
    },
    pool,
    samplePosition,
  );
  console.log(`    nSnapshots       = ${replayOut.nSnapshots}`);
  console.log(`    totalSeconds     = ${replayOut.totalSeconds.toString()} (~${(Number(replayOut.totalSeconds) / 86400).toFixed(2)} days)`);
  console.log(`    totalFees        = ${replayOut.totalFeesInNumeraire.toString()} (raw numeraire units)`);
  console.log(`    apr              = ${fmtPct(replayOut.apr, APR_SCALE)}`);
  console.log(`    mean IL          = ${fmtPct(replayOut.meanIl, IL_SCALE)}`);
  console.log(`    min/max IL       = ${fmtPct(replayOut.minIl, IL_SCALE)} / ${fmtPct(replayOut.maxIl, IL_SCALE)}`);
  console.log(`    final IL         = ${fmtPct(replayOut.finalIl, IL_SCALE)}`);
  console.log(`    timeInRange      = ${(Number(replayOut.timeInRangeFraction) / 1e18 * 100).toFixed(2)}%`);
  console.log(`    maxDrawdown      = ${fmtPct(replayOut.maxDrawdown, IL_SCALE)}`);

  // -----------------------------------------------------------------
  // [4] MonteCarloSimulation.
  // -----------------------------------------------------------------
  console.log('\n[4] MonteCarloSimulation (200 paths × 30 daily steps, μ=0, σ_annual ≈ observed) …');
  const analytics = createAnalyticsEngine();
  const vol = analytics.volatilityFromHistory(history);
  const sigmaAnnual = vol?.volAnnual ?? 5n * 10n ** 17n; // fallback 50%/yr

  const mcSim = createMonteCarloSimulation();
  const mcOut = mcSim.run(
    {
      muAnnual: 0n,
      sigmaAnnual,
      numPaths: 200,
      numSteps: 30,
      stepSeconds: SECONDS_PER_DAY,
      seed: 999_999n,
      entryPrice: currentPrice18,
      feeRatePerSecond,
      principalInNumeraire: principalReplay,
      numeraireToken: 'token0',
    },
    pool,
    samplePosition,
  );

  const s = mcOut.summary;
  console.log(`    numPaths         = ${s.numPaths}`);
  console.log(`    mean final IL    = ${fmtPct(s.meanFinalIl, IL_SCALE)}`);
  console.log(`    p5 / p50 / p95 IL = ${fmtPct(s.p5FinalIl, IL_SCALE)} / ${fmtPct(s.p50FinalIl, IL_SCALE)} / ${fmtPct(s.p95FinalIl, IL_SCALE)}`);
  console.log(`    mean APR         = ${fmtPct(s.meanApr, APR_SCALE)}`);
  console.log(`    p5 / p50 / p95 APR = ${fmtPct(s.p5Apr, APR_SCALE)} / ${fmtPct(s.p50Apr, APR_SCALE)} / ${fmtPct(s.p95Apr, APR_SCALE)}`);
  console.log(`    timeInRange mean = ${(Number(s.meanTimeInRange) / 1e18 * 100).toFixed(2)}%`);
  console.log(`    probInRange      = ${(Number(s.probInRange) / 1e18 * 100).toFixed(2)}%`);
  console.log(`    mean terminal    = ${s.meanTerminalValue.toString()} (raw)`);
  console.log(`    p5 / p95 terminal = ${s.p5TerminalValue.toString()} / ${s.p95TerminalValue.toString()}`);

  // -----------------------------------------------------------------
  // [5] Sanity checks.
  // -----------------------------------------------------------------
  console.log('\n[5] Sanity assertions …');

  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  // Future-price scenarios: unchanged ⇒ IL ≈ 0; TV at unchanged
  // depends on the position's amount0/amount1 split (a balanced LP
  // holds ~equal value in both tokens, so TV ≈ 2× the deposit
  // principal at unchanged price). We just check IL and that TV
  // is positive.
  const unchangedSc = futureSim.run(
    {
      entryPrice,
      futurePrice: entryPrice,
      numeraireToken: 'token0',
      principalInNumeraire: principalFuture,
    },
    pool,
    futurePosition,
  );
  checks.push({
    name: 'future-price unchanged IL ≈ 0',
    pass: Math.abs(Number(unchangedSc.il)) < 1e14, // 0.0001
    detail: `il=${unchangedSc.il}`,
  });
  checks.push({
    name: 'future-price unchanged TV > 0',
    pass: unchangedSc.terminalValueInNumeraire > 0n,
    detail: `tv=${unchangedSc.terminalValueInNumeraire}`,
  });

  // Historical replay: totalFees > 0 if the position was in-range
  // for some intervals.
  checks.push({
    name: 'historical-replay fees > 0 (in-range some of the time)',
    pass: replayOut.totalFeesInNumeraire > 0n,
    detail: `fees=${replayOut.totalFeesInNumeraire}`,
  });

  // Historical replay: timeInRangeFraction ∈ [0, 1] at 1e18.
  checks.push({
    name: 'historical-replay timeInRange ∈ [0,1]',
    pass: replayOut.timeInRangeFraction >= 0n && replayOut.timeInRangeFraction <= 10n ** 18n,
  });

  // MC: p5 ≤ p50 ≤ p95 ordering.
  checks.push({
    name: 'MC IL p5 ≤ p50 ≤ p95',
    pass: s.p5FinalIl <= s.p50FinalIl && s.p50FinalIl <= s.p95FinalIl,
  });
  checks.push({
    name: 'MC APR p5 ≤ p50 ≤ p95',
    pass: s.p5Apr <= s.p50Apr && s.p50Apr <= s.p95Apr,
  });

  // MC: probInRange ∈ [0, 1] at 1e18.
  checks.push({
    name: 'MC probInRange ∈ [0,1]',
    pass: s.probInRange >= 0n && s.probInRange <= 10n ** 18n,
  });

  // Sharpe-like sanity check still works post-extension.
  const sampleScore = analytics.scoreFromWindow(
    replayOut.totalFeesInNumeraire,
    principalReplay,
    SECONDS_PER_DAY * 30n,
    sigmaAnnual,
  );
  checks.push({
    name: 'AnalyticsEngine.scoreFromWindow ≥ 0',
    pass: sampleScore >= 0n,
    detail: `score=${fmtScore(sampleScore)}`,
  });

  let pass = 0;
  for (const c of checks) {
    const icon = c.pass ? '✓' : '✗';
    // eslint-disable-next-line no-console
    console.log(`    ${icon} ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    if (c.pass) {
      pass++;
    }
  }

  console.log(`\n    ${pass}/${checks.length} checks passed`);
  if (pass !== checks.length) {
    throw new Error(`Phase 5 sanity checks failed: ${pass}/${checks.length}`);
  }

  console.log('\n=== Phase 5 smoke complete ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
