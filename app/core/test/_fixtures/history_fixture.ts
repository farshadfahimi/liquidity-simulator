// app/core/test/_fixtures/history_fixture.ts
//
// One-call fixture builder for the GetPoolHistoryUseCase tests.
// Composes:
//   - a stub IRpcProvider serving a caller-supplied block table
//   - a stub IProtocolAdapter whose tick walk produces a
//     non-flat price series
//   - a CoreServices composition root that registers the stub
//     adapter for chain 1 and exposes a fresh
//     GetPoolHistoryUseCase via `.useCases()`
//
// The history use case reads `rpc.getBlockNumber()` to find the
// head and `adapter.getPoolStateAtBlock(_, N)` for each
// historical block, so the only data the caller needs to
// supply is:
//   - the head block number + timestamp
//   - the historical block numbers (one per requested snapshot)
//   - their timestamps (any strictly-increasing sequence works)
//   - the pool's identity + token metadata
//   - the initial tick (current price) + the per-block tick
//     delta (so the resulting price series has real spread)

import { NetworkRegistry } from '@core/network';
import { createCoreServices } from '@core/services';
import type { CoreServices } from '@core/services/core_services.class';
import type { INetworkProvider } from '@core/network/network_provider.interface';
import type { TNetwork } from '@core/network/network_registry.interface';
import { createStubRpcProvider, type IStubBlock } from './stub_rpc_provider';
import { createStubProtocolAdapter, type IStubPoolToken } from './stub_protocol_adapter';
import type { GetPoolHistoryUseCase } from '@core/application/use_cases/get_pool_history.use_case';
import type { IRpcProvider } from '@core/providers/rpc';
import type { TAddress, TChainId } from '@core/shared/types';

export interface IHistoryFixtureOptions {
  /** Pool address. */
  readonly pool: TAddress;

  /** USDC/WETH-style token0 (the one with lower address, typically). */
  readonly token0: IStubPoolToken;

  /** WETH/USDC-style token1. */
  readonly token1: IStubPoolToken;

  /** Pool fee in hundredths of a basis point (500 = 0.05%). */
  readonly fee: number;

  /** Tick spacing (10 for 0.05% / 60 for 0.3% / 200 for 1%). */
  readonly tickSpacing: number;

  /**
   * Tick at the head. The historical blocks walk *backwards*
   * with the per-block tick delta subtracted, so the
   * oldest block in the window has the lowest tick (= lowest
   * price). Mirrors the on-chain convention where each block
   * holds a slightly different state.
   */
  readonly initialTick: number;

  /**
   * How many ticks to subtract per block step. Default 1.
   * Each `getPoolStateAtBlock` call gets tick
   * `initialTick - blocksAgo * tickDeltaPerBlock`.
   */
  readonly tickDeltaPerBlock?: number;

  /**
   * Head block number (also the value the stub RPC reports
   * from `getBlockNumber()`). Historical blocks are computed
   * as `head - i * blockStep` for `i = 0..numSnapshots-1`,
   * oldest first.
   */
  readonly headBlock: bigint;

  /**
   * Block step (in blocks) between consecutive snapshots.
   * Mirrors the `blockStep` field on
   * `IGetPoolHistoryInput`.
   */
  readonly blockStep: bigint;

  /**
   * Head block timestamp (unix seconds). Each historical
   * block `head - i * blockStep` gets timestamp
   * `headTimestamp - i * blockStepSeconds`, where
   * `blockStepSeconds` is derived from the Ethereum default
   * 12s/block. (The history use case resolves the block time
   * via the per-chain `BLOCK_TIME_SECONDS` table; mainnet
   * defaults to 12s.)
   */
  readonly headTimestamp: bigint;

  /** Chain ID (default 1 = Ethereum mainnet). */
  readonly chainId?: number;
}

export interface IHistoryFixture {
  /** Freshly-constructed use case bundle; the history one is the one most tests want. */
  readonly services: CoreServices;

  /** Convenience accessor for the history use case. */
  readonly getPoolHistory: GetPoolHistoryUseCase;

  /** The stub RPC — useful for direct assertions in edge-case tests. */
  readonly rpc: ReturnType<typeof createStubRpcProvider>;

  /** The stub adapter — useful for direct assertions. */
  readonly adapter: ReturnType<typeof createStubProtocolAdapter>;
}

/**
 * Build a fully-wired (RPC + adapter + CoreServices) fixture
 * for testing `GetPoolHistoryUseCase` end-to-end with no
 * network. The fixture exposes a `getPoolHistory` reference so
 * tests can write
 *
 *     const fx = buildHistoryFixture({ ... });
 *     const result = await fx.getPoolHistory.execute({ ... });
 *
 * and have it just work, regardless of whether the public RPC
 * is reachable.
 *
 * The block table is built lazily from the head so the caller
 * only has to specify the *head* + a regular `blockStep`. The
 * test does not need to pre-compute a list of `IStubBlock` —
 * the fixture fills in `numSnapshots` evenly-spaced blocks.
 *
 * NOTE: the fixture uses a deterministic number of historical
 * blocks (200, matching `MAX_AUTO_SNAPSHOTS`) and 12s/block
 * (the mainnet default). Callers that need a different
 * resolution should set the `numSnapshots` / `blockStep` on
 * the use case's input; the stub will satisfy the resulting
 * block range on demand. Blocks past the fixture's pre-built
 * 200 will be reported as missing — tests that need a wider
 * window should set `numSnapshots` ≤ 200.
 */
export function buildHistoryFixture(
  options: IHistoryFixtureOptions,
): IHistoryFixture {
  const chainId = options.chainId ?? 1;
  const blockStepSeconds = 12n; // mainnet default
  const numHistoricalBlocks = 200; // matches MAX_AUTO_SNAPSHOTS

  // Build a regular block table: one block every `blockStep`
  // blocks, one timestamp every `blockStep * 12` seconds, going
  // back from the head.
  const blocks: IStubBlock[] = [];
  for (let i = 0; i < numHistoricalBlocks; i++) {
    const offsetBlocks = BigInt(i) * options.blockStep;
    const offsetSeconds = offsetBlocks * blockStepSeconds;
    blocks.push({
      number: options.headBlock - offsetBlocks,
      timestamp: options.headTimestamp - offsetSeconds,
    });
  }

  const rpc = createStubRpcProvider({
    blocks,
    latestBlock: options.headBlock,
  });

  const adapter = createStubProtocolAdapter({
    pool: options.pool,
    token0: options.token0,
    token1: options.token1,
    fee: options.fee,
    tickSpacing: options.tickSpacing,
    initialTick: options.initialTick,
    tickDeltaPerBlock: options.tickDeltaPerBlock,
    latestBlock: options.headBlock,
  });

  // Build a minimal network entry. We don't need
  // `createNetworkProvider` here — the use case only calls
  // `network.rpc()` and `services.rpc()` (which is
  // `network.rpc()`). A hand-rolled INetworkProvider lets us
  // return *our* stub RPC directly, with no viem dependency.
  const networkEntry: TNetwork = {
    id: chainId,
    name: 'Test chain',
    rpcUrl: 'http://stub.invalid',
    rpcUrls: ['http://stub.invalid'],
    explorerUrl: 'http://stub.invalid/explorer',
    nativeCurrency: { name: 'Stub', symbol: 'STUB', decimals: 18 },
    multicall3Address: '0x0000000000000000000000000000000000000000',
  };
  // Touch the registry so the network entry's identity is
  // identical to one a real call would produce. Not strictly
  // required — the use case only ever asks for `rpc()`.
  const registry = new NetworkRegistry();
  registry.register(networkEntry);
  void registry;

  const stubNetwork: INetworkProvider = {
    current: () => networkEntry,
    rpc: () => rpc as unknown as IRpcProvider,
    switch: (_id: TChainId) => networkEntry,
  };

  const services = createCoreServices({
    network: stubNetwork,
    adapters: new Map([[chainId, [adapter]]]),
  });

  const useCases = services.useCases();
  return {
    services,
    getPoolHistory: useCases.getPoolHistory,
    rpc,
    adapter,
  };
}
