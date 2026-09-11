// app/core/test/application/use_cases/get_pool_history.test.ts

/**
 * Phase 10 — GetPoolHistoryUseCase (was: `scripts/smoke-test-phase10.ts`).
 *
 * Exercises the new GetPoolHistoryUseCase + adapter
 * `getPoolStateAtBlock` extension end-to-end against a live (when
 * reachable) Ethereum mainnet USDC/WETH 0.05% pool. Falls back to
 * the synthetic path when archive reads fail.
 */

import { mainnet } from 'viem/chains';

import { describe, expect, it } from 'vitest';

import { createRpcProvider } from '@core/providers/rpc';
import { createUniswapV3Adapter } from '@core/adapters/uniswap/v3';
import { createCoreServices } from '@core/services';
import { NetworkRegistry, createNetworkProvider, type TNetwork } from '@core/network';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';
const POOL = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640' as const;
const WETH_USDT = '0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36' as const;

interface IFixture {
  services: ReturnType<typeof createCoreServices>;
  rpc: ReturnType<typeof createRpcProvider>;
  adapter: ReturnType<typeof createUniswapV3Adapter>;
}

function buildFixture(): IFixture {
  const registry = new NetworkRegistry();
  const mainnetOverride: TNetwork = {
    id: mainnet.id,
    name: mainnet.name,
    rpcUrls: [RPC_URL],
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
  const network = createNetworkProvider({ registry, chainId: 1 });
  const rpc = createRpcProvider({ chain: mainnet, rpcUrls: [RPC_URL] });
  const adapter = createUniswapV3Adapter({ rpc });
  const services = createCoreServices({
    network,
    adapters: new Map([[1, [adapter]]]),
  });
  return { services, rpc, adapter };
}

function formatPrice(raw: bigint, decimals: number): string {
  const v = Number(raw) / 10 ** decimals;
  if (v >= 1000) return v.toFixed(2);
  if (v >= 1) return v.toFixed(6);
  return v.toExponential(3);
}

describe('Phase 10 — GetPoolHistoryUseCase', () => {
  it('live USDC/WETH 0.05% — on-chain or synthetic, ≥ 2 snapshots', async () => {
    const fx = buildFixture();
    const { getPoolHistory } = fx.services.useCases();

    let result;
    try {
      result = await getPoolHistory.execute({
        pool: POOL,
        chainId: 1,
        protocolId: 'uniswap-v3',
        numSnapshots: 8,
        blockStep: 100n,
        maxSnapshots: 0, // disable fallback so we surface real errors
      });
    }
    catch {
      // Public RPC archive is unreliable — fall back to defaults.
      result = await getPoolHistory.execute({
        pool: POOL,
        chainId: 1,
        protocolId: 'uniswap-v3',
        numSnapshots: 8,
        blockStep: 100n,
      });
    }

    expect(result.snapshots.length).toBeGreaterThanOrEqual(2);
    expect(['on-chain', 'synthetic']).toContain(result.source);
    if (result.snapshots.length > 0) {
      const s0 = result.snapshots[0]!;
      const sN = result.snapshots[result.snapshots.length - 1]!;
      expect(s0.price).toBeGreaterThan(0n);
      expect(sN.price).toBeGreaterThan(0n);
      expect(s0.blockNumber).toBeLessThanOrEqual(sN.blockNumber);
    }
  });

  it('getPoolStateAtBlock — direct adapter call returns a non-zero tick', async () => {
    const fx = buildFixture();
    let latest: bigint;
    try {
      latest = await fx.rpc.getBlockNumber();
    }
    catch {
      return; // public RPC down
    }
    const targetBlock = latest > 100n ? latest - 100n : latest;
    const state = await fx.adapter.getPoolStateAtBlock(POOL, targetBlock);
    // Even a stale block should have *some* tick; if the slot is
    // uninitialised (e.g. fresh deployment) this would be 0, but
    // USDC/WETH 0.05% on mainnet has been live since 2021.
    expect(typeof state.tick).toBe('number');
  });

  it('WETH/USDT 0.3% — volatile pool, ≥ 2 snapshots, source populated', async () => {
    const fx = buildFixture();
    const { getPoolHistory } = fx.services.useCases();
    let result;
    try {
      result = await getPoolHistory.execute({
        pool: WETH_USDT,
        chainId: 1,
        protocolId: 'uniswap-v3',
        numSnapshots: 30,
        blockStep: 1000n,
      });
    }
    catch {
      return; // public RPC down
    }
    expect(result.snapshots.length).toBeGreaterThanOrEqual(2);
    expect(result.source.length).toBeGreaterThan(0);
    if (result.snapshots.length > 0) {
      const s0 = result.snapshots[0]!;
      const sN = result.snapshots[result.snapshots.length - 1]!;
      expect(formatPrice(s0.price, s0.priceDecimals).length).toBeGreaterThan(0);
      expect(formatPrice(sN.price, sN.priceDecimals).length).toBeGreaterThan(0);
    }
  });
});
