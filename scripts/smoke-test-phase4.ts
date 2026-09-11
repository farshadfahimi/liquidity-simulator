// scripts/smoke-test-phase4.ts

/**
 * Phase 4 end-to-end live + synthetic smoke test.
 *
 * Wires the math engine + analytics extensions:
 *   - RPC + Uniswap V3 adapter (read live pool state)
 *   - Synthesize a 7-day daily price history (simulating ~50% annualized
 *     vol for USDC/WETH) — used as input for realized-volatility
 *     computation. Public RPCs (publicnode, llamp) require archive
 *     tokens for `eth_call` at past blocks; for the smoke we keep the
 *     math deterministic by deriving prices from the live current state.
 *   - AnalyticsEngine: IL at current price, capital efficiency,
 *     realized volatility, APR-from-fee-window, Sharpe-like score.
 *   - VolatilityAdjustedRangeGenerator alongside ConstantRangeGenerator.
 *
 * Run: `npx -y tsx scripts/smoke-test-phase4.ts`
 */

import { mainnet } from 'viem/chains';

import { createRpcProvider } from '../app/core/providers/rpc';
import { createUniswapV3Adapter } from '../app/core/adapters/uniswap/v3';

import {
  createPool,
  createAnalyticsEngine,
  createConstantRangeGenerator,
  createVolatilityAdjustedRangeGenerator,
} from '../app/core/domains';
import { PoolSnapshot } from '../app/core/domains/history';
import { createPoolHistory } from '../app/core/domains/history';
import { Position } from '../app/core/domains/position';
import { Price, TickRange, sqrtPriceX96ToPrice } from '../app/core/shared/value_objects';
import { formatAmount } from '../app/core/shared/utils';
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

// Deterministic PRNG (LCG) so the synthetic history is reproducible.
function lcg(seed: bigint): bigint {
  return (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
}

function fmtPct(v: bigint, scale: bigint = VOLATILITY_SCALE): string {
  return `${(Number(v) / Number(scale) * 100).toFixed(2)}%`;
}

function fmtScore(v: bigint): string {
  return `${(Number(v) / Number(SCORE_SCALE)).toFixed(4)}`;
}

/**
 * Build a synthetic 7-day daily price history with deterministic
 * Gaussian-ish noise (uniform distribution per step) anchored on the
 * current pool price.
 *
 * The series is roughly 50% annualized vol at a daily cadence, which
 * is in the right ballpark for USDC/WETH in active regimes.
 */
function buildSyntheticHistory(
  pool: `0x${string}`,
  chainId: number,
  currentSqrtPriceX96: bigint,
  currentTick: number,
  currentLiquidity: bigint,
  token0Decimals: number,
  token1Decimals: number,
  daysBack: number,
  dailySigmaPct: number,
  seed: bigint,
): readonly PoolSnapshot[] {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const startBlock = 21_000_000n;

  const ONE = 1_000_000_000_000_000_000n;
  const snap: PoolSnapshot[] = [];

  // Walk forward from oldest to newest; the *latest* snapshot matches
  // the live current state.
  let logP = 0n; // start at log(P) = 0 (anchor: p=1)
  let s = seed;
  for (let i = 0; i < daysBack; i++) {
    s = lcg(s);
    // Map to [-3*sigma, +3*sigma] (uniform approximation of normal).
    const noise = (Number(s) / Number(1n << 64n)) * 6 * dailySigmaPct - 3 * dailySigmaPct;
    const noiseScaled = BigInt(Math.round(noise / 100 * Number(ONE)));
    // log(P_new) = log(P_old) + noise, but we anchor so log(P) at
    // the *last* step equals log(currentPrice).
    logP += noiseScaled;
  }

  // After the loop, logP holds the cumulative log-return from start
  // to the *current* day. We re-distribute the increments so that the
  // final snapshot equals the live price exactly. Concretely:
  //   day_i price = currentPrice * exp(-(logP - sum_{j >= i} noise_j))
  // We just keep the cumulative series and *re-scale* so the last
  // value equals log(currentPrice).

  // Reset and re-walk, recording per-step logP (cumulative).
  logP = 0n;
  s = seed;
  const logPReturns: bigint[] = [];
  for (let i = 0; i < daysBack; i++) {
    s = lcg(s);
    const noise = (Number(s) / Number(1n << 64n)) * 6 * dailySigmaPct - 3 * dailySigmaPct;
    const noiseScaled = BigInt(Math.round(noise / 100 * Number(ONE)));
    logP += noiseScaled;
    logPReturns.push(logP);
  }
  // logPReturns[i] = log(P at end of day i / P at start).
  const totalLogP = logPReturns.at(-1)!;

  // Now compute the per-day prices such that the final day equals the
  // live current price. livePrice / livePrice = 1.0, so:
  //   p_day_i = exp(logPReturns[i] - totalLogP) * currentPrice
  // Implementation: compute scale = 10^PRICE_DECIMALS; price = exp(logPReturns[i] - totalLogP) * currentPriceScaled / scale.
  // We approximate exp via Taylor; |logPReturns[i] - totalLogP| is small.

  const currentPrice = sqrtPriceX96ToPrice(
    currentSqrtPriceX96,
    token0Decimals,
    token1Decimals,
    PRICE_DECIMALS,
  );
  const currentPriceBig = currentPrice.value;

  // exp(x) at 1e18 precision via Taylor (4 terms is enough for |x| < 0.3).
  function exp1e18(xScaled: bigint, xScale: bigint): bigint {
    const ONE = xScale;
    const x = xScaled * ONE / xScale;
    const x2 = x * x / ONE;
    const x3 = x2 * x / ONE;
    const x4 = x3 * x / ONE;
    const x5 = x4 * x / ONE;
    return ONE + x + x2 / 2n + x3 / 6n + x4 / 24n + x5 / 120n;
  }

  // For each day i (0 = oldest), compute the price as
  //   currentPrice * exp(logPReturns[i] - totalLogP)
  // The exponent is in 1e18 scale (since logPReturns and totalLogP are 1e18).

  for (let i = 0; i < daysBack; i++) {
    const expArg = logPReturns[i]! - totalLogP;
    const expVal = exp1e18(expArg, ONE);
    const priceBig = (currentPriceBig * expVal) / ONE;

    // Compute tick from the price ratio vs current.
    const priceRatio = Number(priceBig) / Number(currentPriceBig);
    const ratio = priceRatio;
    const tickDelta = Math.round(Math.log(ratio) / Math.log(1.0001));
    const tick = currentTick + tickDelta;

    snap.push(new PoolSnapshot(
      pool,
      chainId,
      startBlock + BigInt(i * 1000),
      now - BigInt(daysBack - 1 - i) * SECONDS_PER_DAY,
      currentSqrtPriceX96, // synthetic; we only use price for vol
      tick,
      currentLiquidity,
      new Price(priceBig, PRICE_DECIMALS),
    ));
  }

  return snap;
}

async function main() {
  console.log('=== Phase 4 — Mathematical Engine smoke test ===\n');

  // 1. Provider + adapter (live).
  const rpc = createRpcProvider({ chain: mainnet, rpcUrl: RPC_URL });
  const adapter = createUniswapV3Adapter({ rpc });

  console.log('[1] Resolving USDC/WETH 0.05% pool …');
  const poolAddress = await adapter.resolvePool(MAINNET_USDC, MAINNET_WETH, FEE_500);
  if (!poolAddress) {
    throw new Error('Could not resolve USDC/WETH 0.05% pool');
  }

  console.log('[2] Reading current pool state …');
  const state = await adapter.getPoolState(poolAddress);
  console.log(
    `    ${state.token0.symbol}/${state.token1.symbol}  tick=${state.tick}  liquidity=${state.liquidity}`,
  );

  const pool = createPool({ state, chainId: mainnet.id });

  // 3. Build a 7-day synthetic history.
  console.log('\n[3] Building synthetic 7-day daily history …');
  const history = createPoolHistory({
    pool: poolAddress,
    chainId: mainnet.id,
    snapshots: buildSyntheticHistory(
      poolAddress,
      mainnet.id,
      state.sqrtPriceX96,
      state.tick,
      state.liquidity,
      state.token0.decimals,
      state.token1.decimals,
      8, // 8 days (7 returns)
      3.0, // 3% daily σ ≈ 3% * sqrt(365) ≈ 57% annualized (active regime)
      12345n, // deterministic seed
    ),
  });
  console.log(`    history.size = ${history.size()}`);

  // 4. Realized volatility from history.
  console.log('\n[4] Realized volatility from history …');
  const analytics = createAnalyticsEngine();
  const vol = analytics.volatilityFromHistory(history);
  if (!vol) {
    throw new Error('Volatility computation returned null (need ≥ 2 snapshots)');
  }
  console.log(`    n returns     = ${vol.nReturns}`);
  console.log(`    mean Δt       = ${vol.meanDt.toString()} s (~${Number(vol.meanDt / SECONDS_PER_DAY).toFixed(2)} days)`);
  console.log(`    σ per period  = ${fmtPct(vol.volPerPeriod)}`);
  console.log(`    σ annual      = ${fmtPct(vol.volAnnual)}`);

  // 5. IL at current price (vs earliest snapshot).
  console.log('\n[5] Impermanent loss (vs earliest snapshot entry price) …');
  const earliest = history.earliest();
  if (!earliest) {
    throw new Error('No earliest snapshot');
  }
  const il = analytics.ilAtCurrentPrice(pool, earliest.price);
  console.log(`    IL = ${fmtPct(il, IL_SCALE)}  (negative = loss vs HODL)`);

  // 6. Capital efficiency for sample ranges.
  console.log('\n[6] Capital efficiency for sample ranges …');
  const widths = [100, 500, 2000];
  for (const w of widths) {
    const halfWidth = w * state.tickSpacing;
    const lo = state.tick - halfWidth;
    const hi = state.tick + halfWidth;
    const range = new TickRange(lo, hi);
    const ce = analytics.capitalEfficiency(range);
    console.log(`    ±${w}×spacing (width=${range.width()} ticks): CE = ${(Number(ce) / Number(CAPITAL_EFFICIENCY_SCALE)).toFixed(2)}×`);
  }

  // 7. Range generators: constant vs volatility-adjusted.
  console.log('\n[7] Range generators …');
  const constantGen = createConstantRangeGenerator({
    widthsTicks: [100, 500, 2000],
  });
  const constantCandidates = constantGen.generate(pool);
  console.log(`    ConstantRangeGenerator produced ${constantCandidates.length} ranges`);
  for (const r of constantCandidates) {
    console.log(`      ticks=[${r.tickLower}, ${r.tickUpper}], width=${r.width()}`);
  }

  // Convert σ_annual → daily σ in tick units.
  const sigmaAnnualFraction = Number(vol.volAnnual) / Number(VOLATILITY_SCALE);
  const sigmaDayFraction = sigmaAnnualFraction / Math.sqrt(365);
  // 1 tick ≈ ln(1.0001) ≈ 0.0001 of log-price.
  const LNP1 = Math.log(1.0001);
  const dailySigmaTicks = Math.max(1, Math.round(sigmaDayFraction / LNP1));
  console.log(`    derived dailySigmaTicks ≈ ${dailySigmaTicks} (from σ_annual=${fmtPct(vol.volAnnual)})`);

  const volGen = createVolatilityAdjustedRangeGenerator({
    dailySigmaTicks,
    sigmaMultipliers: [1, 2, 4],
  });
  const volCandidates = volGen.generate(pool);
  console.log(`    VolatilityAdjustedRangeGenerator produced ${volCandidates.length} ranges`);
  for (const r of volCandidates) {
    console.log(`      ticks=[${r.tickLower}, ${r.tickUpper}], width=${r.width()}`);
  }

  // 8. APR + Sharpe-like score from a synthetic 7-day fee window.
  console.log('\n[8] APR + Sharpe-like score (synthetic 7d fee window) …');
  const windowSeconds = 7n * SECONDS_PER_DAY;
  const fees0 = 50_000n; // 0.05 USDC
  const fees1Num = 50_000n; // 0.05 USDC equivalent fees from ETH side
  const principal0 = 100n * 1_000_000n; // 100 USDC
  const principal1Num = 100n * 1_000_000n; // 100 USDC equivalent

  const apr = analytics.apr(fees0 + fees1Num, principal0 + principal1Num, windowSeconds);
  console.log(`    APR (fee window): ${fmtPct(apr, APR_SCALE)}`);

  const score = analytics.scoreFromWindow(
    fees0 + fees1Num,
    principal0 + principal1Num,
    windowSeconds,
    vol.volAnnual,
  );
  console.log(`    Sharpe-like score: ${fmtScore(score)}  (excess/vol)`);

  // 9. Position metrics bundle for one candidate range.
  console.log('\n[9] Position metrics bundle (constant #2, ±500 spacing) …');
  const sampleRange = constantCandidates[1]!;
  const sampleQuote = await adapter.quotePosition(
    poolAddress,
    { tickLower: sampleRange.tickLower, tickUpper: sampleRange.tickUpper },
    1_000_000n,
  );
  const samplePosition = Position.fromQuote(poolAddress, sampleQuote);
  const sampleEntryPrice = earliest.price;

  const metrics = analytics.positionMetrics(pool, samplePosition, sampleEntryPrice);
  console.log(`    range         = [${sampleRange.tickLower}, ${sampleRange.tickUpper}]`);
  console.log(`    in-range side = ${metrics.side}`);
  console.log(`    IL            = ${fmtPct(metrics.il, IL_SCALE)}`);
  console.log(`    CE            = ${(Number(metrics.ce) / Number(CAPITAL_EFFICIENCY_SCALE)).toFixed(2)}×`);
  console.log(`    amount0       = ${formatAmount(samplePosition.amount0, state.token0.decimals)} ${state.token0.symbol}`);
  console.log(`    amount1       = ${formatAmount(samplePosition.amount1, state.token1.decimals)} ${state.token1.symbol}`);

  console.log('\n=== Phase 4 smoke complete ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});