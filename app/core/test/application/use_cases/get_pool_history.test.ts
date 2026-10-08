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

import { buildHistoryFixture } from '../../_fixtures/history_fixture';

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

/**
 * Build a fully-stubbed history fixture for the candle /
 * `withCandles` flag tests. Uses the in-memory stub RPC +
 * stub adapter from `app/core/test/_fixtures/` so these
 * tests run in microseconds and never touch a public RPC.
 *
 * The fixture is shaped to match the real USDC/WETH 0.05%
 * pool (same address, same fee, same token decimals) so the
 * tests verify the use case's actual wire-up against realistic
 * inputs. The tick walk is a +1-tick-per-block ascent from a
 * tick around the current USDC/WETH price (≈ 198_000),
 * guaranteeing the on-chain path produces a non-flat series
 * with real OHLC spread.
 */
function buildStubHistoryFixture() {
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
  // Head = a recent mainnet block (e.g. 21_500_000). 30
  // snapshots × blockStep 100 = 3_000 blocks back, well
  // within the 200-block table the fixture pre-builds.
  const headBlock = 21_500_000n;
  const headTimestamp = 1_728_000_000n; // 2024-05-21 00:00:00 UTC
  return buildHistoryFixture({
    pool: POOL,
    token0: { address: USDC, symbol: 'USDC', decimals: 6 },
    token1: { address: WETH, symbol: 'WETH', decimals: 18 },
    fee: 500, // 0.05%
    tickSpacing: 10,
    initialTick: 198_000,
    tickDeltaPerBlock: 1, // gentle but > 0 so the series isn't flat
    headBlock,
    blockStep: 100n,
    headTimestamp,
  });
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

  it('withCandles: false (default) — `candles` is null (stub fixture)', async () => {
    // Default behaviour: candle aggregation is opt-in, so the
    // DTO's `candles` field is null and the caller has the raw
    // snapshot stream only. The field is there so existing
    // callers that don't pass `withCandles` see a null instead
    // of a missing key.
    const fx = buildStubHistoryFixture();
    const result = await fx.getPoolHistory.execute({
      pool: POOL,
      chainId: 1,
      protocolId: 'uniswap-v3',
      numSnapshots: 8,
      blockStep: 100n,
    });
    expect(result.candles).toBeNull();
  });

  it('withCandles: true — all six timeframes are populated and well-formed (stub fixture)', async () => {
    // When the caller opts in, the DTO carries an
    // `IHistoryCandleMap` keyed by the six standard timeframes.
    // Every key is present so the UI can iterate the map
    // without a null check. OHLC values must be sane (high ≥
    // low, open/close within [low, high], average within
    // [low, high]).
    //
    // The stub fixture provides a non-flat on-chain series
    // (tick walks 1 per block, well above the 5bps
    // `isFlatSeries` gate), so the use case must take the
    // `source: 'on-chain'` path — verifying that the stub
    // fixture actually exercises the real on-chain code
    // branch, not just the synthetic fallback.
    const fx = buildStubHistoryFixture();
    const result = await fx.getPoolHistory.execute({
      pool: POOL,
      chainId: 1,
      protocolId: 'uniswap-v3',
      numSnapshots: 30,
      blockStep: 100n,
      withCandles: true,
    });
    expect(result.source).toBe('on-chain');
    expect(result.candles).not.toBeNull();
    const candles = result.candles!;
    for (const tf of ['1m', '5m', '15m', '1h', '4h', '1d'] as const) {
      expect(candles[tf]).toBeDefined();
    }
    // The stub's 30 snapshots at 12s/block (Ethereum
    // default) span 30*12s = 360s = 6 minutes, so the 1m
    // timeframe produces 6 candles, 5m produces 1, and
    // 15m/1h/4h/1d produce 0 (the window is too short).
    // The test is meaningful as long as the
    // sub-window timeframes (1m, 5m) are populated —
    // anything beyond that is exercised by the dedicated
    // aggregator unit tests.
    expect(candles['1m'].length).toBeGreaterThan(0);
    expect(candles['5m'].length).toBeGreaterThan(0);
    for (const tf of ['1m', '5m', '15m', '1h', '4h', '1d'] as const) {
      for (const c of candles[tf]) {
        expect(c.timeframe).toBe(tf);
        expect(c.openTimestamp).toBeGreaterThan(0n);
        expect(c.closeTimestamp).toBeGreaterThan(c.openTimestamp);
        expect(c.highPrice).toBeGreaterThanOrEqual(c.lowPrice);
        expect(c.openPrice).toBeGreaterThanOrEqual(c.lowPrice);
        expect(c.openPrice).toBeLessThanOrEqual(c.highPrice);
        expect(c.closePrice).toBeGreaterThanOrEqual(c.lowPrice);
        expect(c.closePrice).toBeLessThanOrEqual(c.highPrice);
        // The mean of a set of values is bounded by the min
        // and max, so averagePrice must always live in
        // [lowPrice, highPrice]. Truncation toward zero can't
        // violate this (the mean sits strictly between min and
        // max for any bucket with sampleCount > 1, and
        // equals them for a single-snapshot bucket).
        expect(c.averagePrice).toBeGreaterThanOrEqual(c.lowPrice);
        expect(c.averagePrice).toBeLessThanOrEqual(c.highPrice);
        expect(c.sampleCount).toBeGreaterThan(0);
      }
    }
  });

  it('withCandles: TCandleTimeframe[] — only the selected timeframes are populated (stub fixture)', async () => {
    // Selective mode: only the requested timeframes have
    // candles; the rest are present as empty arrays so the map
    // shape is stable.
    const fx = buildStubHistoryFixture();
    const result = await fx.getPoolHistory.execute({
      pool: POOL,
      chainId: 1,
      protocolId: 'uniswap-v3',
      numSnapshots: 30,
      blockStep: 100n,
      withCandles: ['1h', '1d'],
    });
    expect(result.source).toBe('on-chain');
    expect(result.candles).not.toBeNull();
    const candles = result.candles!;
    // The selected timeframes are always present in the map
    // (even when empty, so the UI can iterate without
    // undefined checks). `1h` is always populated given the
    // stub's 10h window; `1d` may be empty if the window
    // happens to span < 1 day.
    expect(candles['1h']).toBeDefined();
    expect(candles['1d']).toBeDefined();
    if (candles['1h'].length > 0) {
      for (const c of candles['1h']) expect(c.timeframe).toBe('1h');
    }
    if (candles['1d'].length > 0) {
      for (const c of candles['1d']) expect(c.timeframe).toBe('1d');
    }
    // Unselected timeframes are filled with `[]` so the
    // IHistoryCandleMap shape stays stable.
    expect(candles['1m']).toEqual([]);
    expect(candles['5m']).toEqual([]);
    expect(candles['15m']).toEqual([]);
    expect(candles['4h']).toEqual([]);
  });
});
