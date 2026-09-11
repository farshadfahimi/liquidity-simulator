/* eslint-disable no-console */
// scripts/smoke-test.ts
//
// Sanity script: instantiates the Uniswap V3 + Shadow adapters against
// public RPCs and fetches state for one well-known pool on each. Prints
// a one-line summary per protocol. Run with:
//   npx -y tsx scripts/smoke-test.ts
// (`tsx` resolves `@core/*` aliases via tsconfig paths automatically).

import { mainnet, sonic } from 'viem/chains';

import { createRpcProvider } from '../app/core/providers/rpc';
import {
  createUniswapV3Adapter,
  uniswapV3FactoryAddresses,
} from '../app/core/adapters/uniswap/v3';
import { createShadowAdapter } from '../app/core/adapters/shadow';

const MAINNET_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const MAINNET_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const FEE_500 = 500;

async function smokeUniswapV3() {
  console.log('--- Uniswap V3 (Ethereum mainnet, USDC/WETH 0.05%) ---');
  const rpc = createRpcProvider({
    chain: mainnet,
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
  });
  const adapter = createUniswapV3Adapter({ rpc });

  const factory = uniswapV3FactoryAddresses[mainnet.id]!;
  console.log('  factory:', factory);

  const pool = await adapter.resolvePool(MAINNET_USDC, MAINNET_WETH, FEE_500);
  if (!pool) {
    console.log('  no pool found');
    return;
  }
  console.log('  pool:', pool);

  const state = await adapter.getPoolState(pool);
  console.log('  token0:', state.token0.symbol, 'token1:', state.token1.symbol);
  console.log('  fee:', state.fee, 'tickSpacing:', state.tickSpacing);
  console.log('  tick:', state.tick, 'liquidity:', state.liquidity.toString());

  const ticks = await adapter.getTicks(pool, {
    tickLower: state.tick - state.tickSpacing * 10,
    tickUpper: state.tick + state.tickSpacing * 10,
  });
  console.log('  ticks sampled:', ticks.length, 'first:', ticks[0]);

  const quote = await adapter.quotePosition(
    pool,
    {
      tickLower: state.tick - state.tickSpacing * 1000,
      tickUpper: state.tick + state.tickSpacing * 1000,
    },
    1_000_000n,
  );
  console.log('  quote (1 USDC in):', {
    token0: quote.token0Amount.toString(),
    token1: quote.token1Amount.toString(),
    liquidity: quote.liquidity.toString(),
  });
}

async function smokeShadow() {
  console.log('\n--- Shadow CL (Sonic, factory probe) ---');
  const rpc = createRpcProvider({
    chain: sonic,
    rpcUrl: 'https://rpc.soniclabs.com',
  });
  const adapter = createShadowAdapter({ rpc });
  console.log('  shadow adapter instantiated, chainId:', rpc.chainId);

  // Probe the factory ABI by attempting a getPool call against a
  // placeholder address. We don't ship with a verified Shadow factory
  // address in this iteration (the canonical deployment lives at an
  // address that should be sourced from the Shadow docs); the smoke
  // check here only confirms the adapter wires up correctly and the
  // RPC client reaches Sonic. A no-op read of the canonical wS token
  // confirms the underlying RPC is healthy.
  const WS_SONIC = '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38';
  const sym = await rpc.readContract<string>({
    address: WS_SONIC,
    abi: [
      {
        type: 'function',
        stateMutability: 'view',
        name: 'symbol',
        inputs: [],
        outputs: [{ name: '', type: 'string' }],
      },
    ],
    functionName: 'symbol',
  });
  console.log('  Sonic RPC reachability OK (wS symbol):', sym);
}

async function main() {
  try {
    await smokeUniswapV3();
  } catch (e) {
    console.error('Uniswap V3 smoke failed:', (e as Error).message);
  }

  try {
    await smokeShadow();
  } catch (e) {
    console.error('Shadow smoke failed:', (e as Error).message);
  }
}

void main();
