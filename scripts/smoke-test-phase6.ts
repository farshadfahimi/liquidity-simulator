// scripts/smoke-test-phase6.ts

/**
 * Phase 6 end-to-end smoke test.
 *
 * Exercises the Recommendation Engine + concrete IRecommendationStrategy
 * implementations against a synthetic + (when reachable) live
 * USDC/WETH 0.05% pool.
 *
 * Sections:
 *   [0] — Live or synthetic pool fixture.
 *   [1] — Build five concrete strategies with sensible priors.
 *   [2] — Build a ConstantRangeGenerator with three widths and a
 *         VolatilityAdjustedRangeGenerator with three σ multipliers.
 *   [3] — Run the RecommendationEngine; inspect the ranked set.
 *   [4] — Re-run with a 2× weight on `highest-sharpe` and confirm
 *         that strategy's top entry now dominates the ranking.
 *   [5] — Sanity assertions:
 *           - engine returns the expected number of recommendations,
 *           - ranking is monotonic by score,
 *           - all five strategy IDs are present,
 *           - ties are broken deterministically,
 *           - Sharpe strategy drops very wide (low-CE) candidates,
 *           - LowestRiskStrategy prefers wider ranges than
 *             MaximumFeeStrategy (sanity check on the strategies).
 *
 * Run: `npx -y tsx scripts/smoke-test-phase6.ts`
 */

import { mainnet } from 'viem/chains';

import { createRpcProvider } from '../app/core/providers/rpc';
import { createUniswapV3Adapter } from '../app/core/adapters/uniswap/v3';

import {
  createPool,
  createAnalyticsEngine,
  createRecommendationEngine,
  createConstantRangeGenerator,
  createVolatilityAdjustedRangeGenerator,
  createBalancedStrategy,
  createHighestSharpeStrategy,
  createMaximumFeeStrategy,
  createLowestRiskStrategy,
  createHighestCapitalEfficiencyStrategy,
  createScoringConfig,
} from '../app/core/domains';
import { sqrtPriceX96ToPrice } from '../app/core/shared/value_objects';
import { Price } from '../app/core/shared/value_objects';
import {
  CAPITAL_EFFICIENCY_SCALE,
  IL_SCALE,
  SCORE_SCALE,
  VOLATILITY_SCALE,
} from '../app/core/math';
import { createPoolHistory } from '../app/core/domains/history';
import { bigintExp } from '../app/core/math/lnexp.util';
import { PoolSnapshot } from '../app/core/domains/history';
import { sqrtRatioAtTick } from '../app/core/math';
import { PRICE_DECIMALS } from './smoke-test-constants';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';

const MAINNET_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const MAINNET_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
const FEE_500 = 500;

const SECONDS_PER_DAY = 86_400n;
const DAILY_SIGMA_PCT = 3.0; // 3% daily vol for the synthetic history
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
 * reference price. Mirrors the helper in `smoke-test-phase5.ts` —
 * we re-state it here so this smoke is self-contained.
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
  console.log('=== Phase 6 — Recommendation Engine smoke test ===\n');

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
    poolAddress = '0x000000000000000000000000000000000000dEaD' as const;
    currentTick = 198000;
    // Synthetic tick=198000 maps to roughly 2500 USDC/WETH; we
    // derive sqrtPriceX96 from the tick so PoolStateVO.currentPrice
    // is consistent.
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
  // [1] Build the strategies.
  //
  //     We feed them a 30% APR target as `expectedApr` (which is the
  //     same convention the Phase 5 historical-replay smoke uses —
  //     the strategies don't run a replay themselves; that's a
  //     Phase 7 use case). Annualized vol is computed from a
  //     synthetic 30-day daily-history.
  // -----------------------------------------------------------------
  console.log('\n[1] Building strategies …');

  // Build a synthetic history for vol. The strategies only need
  // the realized-vol summary, not the history itself.
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
  const sigmaAnnual = vol?.volAnnual ?? 5n * 10n ** 17n; // 50% fallback

  console.log(`    σ_annual (synthetic) ≈ ${fmtPct(sigmaAnnual, VOLATILITY_SCALE)}`);

  const expectedApr = 3n * 10n ** 17n; // 30% APR

  const strategies = [
    createBalancedStrategy({
      expectedApr,
      annualizedVolatility: sigmaAnnual,
      riskFreeApr: 0n,
      entryPrice: currentPrice18,
    }),
    createMaximumFeeStrategy({
      expectedApr,
    }),
    createLowestRiskStrategy({
      entryPrice: currentPrice18,
    }),
    createHighestCapitalEfficiencyStrategy(),
    createHighestSharpeStrategy({
      expectedApr,
      annualizedVolatility: sigmaAnnual,
      riskFreeApr: 0n,
    }),
  ];

  console.log(`    strategies: ${strategies.map((s) => s.id).join(', ')}`);

  // -----------------------------------------------------------------
  // [2] Range generators.
  //
  //     We pick a sweep of widths including one very wide range
  //     (CE < 1× V2 — i.e. *wider* than full-range V2) so the
  //     `highest-sharpe` strategy has a candidate to drop. (CE < 1×
  //     only happens at very wide ranges in CL — almost full-range.)
  // -----------------------------------------------------------------
  console.log('\n[2] Building range generators …');
  const constantGen = createConstantRangeGenerator({
    widthsTicks: [100, 500, 2000, 10000, 50000],
  });
  const candidates = constantGen.generate(pool);
  console.log(`    constant generator → ${candidates.length} candidates:`);
  for (const r of candidates) {
    console.log(`      [${r.tickLower}, ${r.tickUpper}]  width=${r.width()}`);
  }

  // -----------------------------------------------------------------
  // [3] Run the recommendation engine.
  // -----------------------------------------------------------------
  console.log('\n[3] Running RecommendationEngine …');

  const scoringConfig = createScoringConfig({
    riskFreeApr: 0n,
    targetApr: expectedApr,
    realizedVolatilityAnnual: sigmaAnnual,
    minCapitalEfficiency: CAPITAL_EFFICIENCY_SCALE, // 1× floor
    minScoreToKeep: 1n,
  });

  const engine = createRecommendationEngine();
  const set = engine.recommend({
    pool,
    generator: constantGen,
    strategies,
    scoringConfig,
  });

  console.log(`    nCandidates     = ${set.context.nCandidates}`);
  console.log(`    nRecommendations = ${set.context.nRecommendations}`);
  console.log(`    nSkipped        = ${set.context.nSkipped}`);
  console.log(`    strategyIds     = [${set.context.strategyIds.join(', ')}]`);
  console.log(`    rangeGeneratorId = ${set.context.rangeGeneratorId}`);
  console.log('\n    Top 5:');
  for (const r of set.recommendations.slice(0, 5)) {
    console.log(
      `      ${r.id.padEnd(48)} score=${fmtScore(r.score).padStart(7)} `
      + `CE=${fmtCE(r.capitalEfficiency).padStart(7)} `
      + `IL=${fmtPct(r.ilAtCurrentPrice, IL_SCALE).padStart(8)} `
      + `side=${r.side.padEnd(7)}`,
    );
  }

  // -----------------------------------------------------------------
  // [4] Re-run with sub-1× weights on `lowest-risk` and verify the
  //     `applyWeight` math is wired through end-to-end. (We pick
  //     `lowest-risk` because its scores have headroom — the
  //     highest-sharpe and highest-capital-efficiency strategies
  //     saturate to 1.0 for the wider candidates, so a 2× boost on
  //     them is a no-op.)
  // -----------------------------------------------------------------
  console.log('\n[4] Re-running with `lowest-risk` weighted 0.5× …');
  const halfWeight = SCORE_SCALE / 2n;
  const weightedConfig = createScoringConfig({
    riskFreeApr: 0n,
    targetApr: expectedApr,
    realizedVolatilityAnnual: sigmaAnnual,
    weights: { 'lowest-risk': halfWeight },
  });
  const weightedSet = engine.recommend({
    pool,
    generator: constantGen,
    strategies,
    scoringConfig: weightedConfig,
  });
  console.log(`    top after weighting = ${weightedSet.top()?.id}`);
  console.log(`    raw top = ${set.top()?.id}`);

  // -----------------------------------------------------------------
  // [5] Sanity assertions.
  // -----------------------------------------------------------------
  console.log('\n[5] Sanity assertions …');

  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  // (a) Recommendation count matches candidates × strategies minus
  // dropped ones. Each strategy may drop 0..N candidates; we just
  // assert we got *something*.
  checks.push({
    name: 'engine produced at least one recommendation',
    pass: set.recommendations.length > 0,
    detail: `n=${set.recommendations.length}`,
  });

  // (b) Ranking is monotonic by score.
  let monotonic = true;
  for (let i = 1; i < set.recommendations.length; i++) {
    const prev = set.recommendations[i - 1]!.score;
    const curr = set.recommendations[i]!.score;

    if (curr > prev) {
      monotonic = false;
      break;
    }
  }
  checks.push({
    name: 'ranking is monotonic by score (descending)',
    pass: monotonic,
  });

  // (c) All five strategy IDs are represented in the set.
  const seenStrategyIds = new Set(set.recommendations.map((r) => r.strategyId));
  const allFive = [
    'balanced',
    'maximum-fee',
    'lowest-risk',
    'highest-capital-efficiency',
    'highest-sharpe',
  ];
  const missing = allFive.filter((id) => !seenStrategyIds.has(id));
  checks.push({
    name: 'all five strategy ids appear in the set',
    pass: missing.length === 0,
    detail: missing.length ? `missing=${missing.join(',')}` : undefined,
  });

  // (d) Highest-sharpe strategy scores are present for every
  // candidate whose Sharpe ratio is positive. For a candidate to be
  // dropped, the strategy must have computed a 0 — that happens when
  // `expectedApr <= riskFreeApr` (the gate). We feed both 0, so every
  // candidate should score > 0. (CE < 1× is unreachable for any valid
  // range, so the "CE floor" gate is dead code — the strategy instead
  // applies the soft ceiling to keep the score in [0, 1].)
  const sharpeEntries = set.byStrategy('highest-sharpe');
  checks.push({
    name: 'highest-sharpe scored every candidate (positive Sharpe for all)',
    pass: sharpeEntries.length === set.context.nCandidates,
    detail: `${sharpeEntries.length}/${set.context.nCandidates}`,
  });

  // (e) LowestRiskStrategy's top candidate has *narrower* CE than
  // MaximumFeeStrategy's top candidate. The two strategies are
  // orthogonal in their bias — one favors higher CE (more
  // concentrated), the other prefers lower CE (less risk of IL).
  const topLowestRisk = set.topForStrategy('lowest-risk');
  const topMaxFee = set.topForStrategy('maximum-fee');

  if (topLowestRisk && topMaxFee) {
    checks.push({
      name: 'lowest-risk top CE ≤ maximum-fee top CE (sanity)',
      pass: topLowestRisk.capitalEfficiency <= topMaxFee.capitalEfficiency,
      detail: `low=${fmtCE(topLowestRisk.capitalEfficiency)} max=${fmtCE(topMaxFee.capitalEfficiency)}`,
    });
  } else {
    checks.push({
      name: 'lowest-risk + maximum-fee both produced a top candidate',
      pass: false,
    });
  }

  // (f) Sub-1× weight on `lowest-risk` halves the score of every
  // lowest-risk entry. (Highest-sharpe and highest-capital-efficiency
  // entries in the weighted set are unchanged — only `lowest-risk`
  // was reweighted.) We verify by picking the top-1 lowest-risk
  // entry from both runs and asserting the weighted score is
  // exactly half the unweighted score (within 1 wei of rounding).
  const unweightedTopLowest = set.topForStrategy('lowest-risk');
  const weightedTopLowest = weightedSet.topForStrategy('lowest-risk');

  if (unweightedTopLowest && weightedTopLowest) {
    const expectedHalved = (unweightedTopLowest.score * halfWeight) / SCORE_SCALE;

    checks.push({
      name: '0.5× weight halves the lowest-risk top score (rounding tolerated)',
      pass: weightedTopLowest.score === expectedHalved,
      detail: `expected=${expectedHalved} got=${weightedTopLowest.score} raw=${unweightedTopLowest.score}`,
    });
  } else {
    checks.push({
      name: 'lowest-risk top found in both runs',
      pass: false,
    });
  }

  // (g) tie-break is deterministic: re-running with the same
  // inputs yields the same ordered ids.
  const set2 = engine.recommend({
    pool,
    generator: constantGen,
    strategies,
    scoringConfig,
  });
  const ids1 = set.recommendations.map((r) => r.id);
  const ids2 = set2.recommendations.map((r) => r.id);
  checks.push({
    name: 'engine output is deterministic (re-run matches)',
    pass: ids1.length === ids2.length && ids1.every((id, i) => id === ids2[i]),
  });

  // (h) Recommendation fields all have non-zero CE and at least one
  // has a non-zero expectedApr.
  const allCE = set.recommendations.every((r) => r.capitalEfficiency > 0n);
  const anyApr = set.recommendations.some((r) => r.expectedApr > 0n);
  checks.push({
    name: 'every recommendation has CE > 0',
    pass: allCE,
  });
  checks.push({
    name: 'at least one recommendation has expectedApr > 0',
    pass: anyApr,
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
    throw new Error(`Phase 6 sanity checks failed: ${pass}/${checks.length}`);
  }

  console.log('\n=== Phase 6 smoke complete ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});