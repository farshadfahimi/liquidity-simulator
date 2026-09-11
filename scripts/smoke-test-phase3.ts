// scripts/smoke-test-phase3.ts

/**
 * Phase 3 end-to-end live smoke test.
 *
 * Wires the entire Core domain stack against live Ethereum mainnet:
 *   - RPC + Uniswap V3 adapter (read live pool state)
 *   - Pool domain aggregate
 *   - Market domain wrapper
 *   - Analytics engine (range prices, position-side, history return)
 *   - ConstantRangeGenerator (multiple candidate ranges)
 *   - DepositSimulation on each candidate
 *
 * Run: `npx -y tsx scripts/smoke-test-phase3.ts`
 */

import { mainnet } from 'viem/chains';

import { createRpcProvider } from '../app/core/providers/rpc';
import { createUniswapV3Adapter } from '../app/core/adapters/uniswap/v3';

import {
  createPool,
  createMarket,
  createAnalyticsEngine,
  createConstantRangeGenerator,
  createDepositSimulation,
  Pool,
} from '../app/core/domains';
import { Position } from '../app/core/domains/position';
import { PoolSnapshot } from '../app/core/domains/history';
import { createPoolHistory } from '../app/core/domains/history';
import { TickRange } from '../app/core/shared/value_objects';
import { formatAmount } from '../app/core/shared/utils';
import { PRICE_DECIMALS } from './smoke-test-constants';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';

// Canonical USDC and WETH on Ethereum mainnet.
const MAINNET_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const MAINNET_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;

// 0.05% fee tier.
const FEE_500 = 500;

const TOKEN0_DEPOSIT_RAW = 1_000_000n; // 1 USDC (raw)

async function main() {
  console.log('=== Phase 3 — Core Domain smoke test ===\n');

  // 1. Provider + adapter.
  const rpc = createRpcProvider({ chain: mainnet, rpcUrl: RPC_URL });
  const adapter = createUniswapV3Adapter({ rpc });

  console.log('[1] Resolving USDC/WETH 0.05% pool …');
  const poolAddress = await adapter.resolvePool(
    MAINNET_USDC,
    MAINNET_WETH,
    FEE_500,
  );
  console.log(`    poolAddress = ${poolAddress}`);

  console.log('[2] Reading pool state …');
  const state = await adapter.getPoolState(poolAddress);
  console.log(
    `    ${state.token0.symbol}/${state.token1.symbol}  tick=${state.tick}  liquidity=${state.liquidity}`,
  );

  // 3. Build Pool and Market domain aggregates.
  console.log('[3] Building domain aggregates …');
  const ticks = await adapter.getTicks(poolAddress, {
    tickLower: state.tick - state.tickSpacing * 50,
    tickUpper: state.tick + state.tickSpacing * 50,
  });
  console.log(`    loaded ${ticks.length} ticks around current tick`);

  const pool: Pool = createPool({
    state,
    chainId: mainnet.id,
    ticks,
  });

  const market = createMarket({ pool, chainId: mainnet.id });
  console.log(`    market = ${market.describe()}`);

  // 4. Spot price.
  const spot = market.currentPrice();
  console.log(`[4] Spot price (token1/token0, ${PRICE_DECIMALS}d): ${spot.toString()}`);

  // 5. Constant range generator: 3 candidate widths.
  console.log('[5] Generating candidate ranges …');
  const generator = createConstantRangeGenerator({
    widthsTicks: [100, 500, 2000],
  });
  const candidates = generator.generate(pool);
  console.log(`    produced ${candidates.length} candidates:`);

  const analytics = createAnalyticsEngine();
  const depositSim = createDepositSimulation();

  for (let i = 0; i < candidates.length; i++) {
    const range = candidates[i]!;
    const { lowerPrice, upperPrice } = analytics.rangePrices(
      pool,
      range,
      PRICE_DECIMALS,
    );

    console.log(
      `    candidate #${i + 1}: ticks [${range.tickLower}, ${range.tickUpper}]`
      + `  width=${range.width()}`
      + `  prices=[${lowerPrice.toString()}, ${upperPrice.toString()}]`,
    );

    // 6. Quote the position via the adapter.
    const quote = await adapter.quotePosition(
      poolAddress,
      { tickLower: range.tickLower, tickUpper: range.tickUpper },
      TOKEN0_DEPOSIT_RAW,
    );

    const position = Position.fromQuote(poolAddress, quote);
    const side = analytics.positionSide(pool, position);

    console.log(
      `      side=${side.side} inRange=${side.inRange}`
      + `  amount0=${formatAmount(position.amount0, state.token0.decimals)} USDC`
      + `  amount1=${formatAmount(position.amount1, state.token1.decimals)} WETH`,
    );

    const sim = depositSim.run(
      { token0Amount: TOKEN0_DEPOSIT_RAW },
      pool,
      position,
    );
    console.log(
      `      deposit-sim: fillRatio=${formatAmount(sim.fillRatio, 18)}`,
    );

    if (i === 0) {
      // First candidate: also test the TickRange value object.
      const tr = new TickRange(range.tickLower, range.tickUpper);
      console.log(`      TickRange.expand(100*tickSpacing) width=${tr.expand(state.tickSpacing * 100).width()}`);
    }
  }

  // 7. Build a synthetic history with 2 snapshots and run historyReturn.
  console.log('[7] Synthetic history & price-move analytics …');
  const now = BigInt(Math.floor(Date.now() / 1000));

  const snapshots = [
    new PoolSnapshot(
      poolAddress,
      mainnet.id,
      21_000_000n,
      now - 3600n,
      state.sqrtPriceX96,
      state.tick,
      state.liquidity,
      pool.currentPrice(PRICE_DECIMALS),
    ),
    new PoolSnapshot(
      poolAddress,
      mainnet.id,
      21_000_100n,
      now,
      state.sqrtPriceX96,
      state.tick,
      state.liquidity,
      pool.currentPrice(PRICE_DECIMALS),
    ),
  ];

  const history = createPoolHistory({
    pool: poolAddress,
    chainId: mainnet.id,
    snapshots,
  });
  const ret = analytics.historyReturn(history);
  console.log(
    `    historyReturn = ${ret ? formatAmount(ret.ratio, ret.decimals) : 'null'}`
    + ` (latest/earliest spot price ratio, 1.0 = no move)`,
  );

  console.log('\n=== Phase 3 smoke complete ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
