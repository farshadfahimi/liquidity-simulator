// app/core/test/application/use_cases/get_pool_tvl_history.test.ts

/**
 * TVL roadmap slice 5 — `GetPoolTvlHistoryUseCase`.
 *
 * The use case turns a pool address into the **TVL trend** the charts
 * tab draws next to the price chart ("liquidity flight"). It is a
 * thin, non-throwing wrapper around the market-data provider:
 *
 *   1. read the pool state (token0 / token1 / fee tier);
 *   2. **discover** the pool's external id by matching the natural key
 *      `(project, chain, token pair, fee tier)` against the provider's
 *      index — the very match the liquidity read performs, and the
 *      only way the provider learns which pool to fetch history for;
 *   3. read the history with that id.
 *
 * The contract the UI depends on (TVL-ROADMAP.md §8):
 *
 *   - an untracked pool, an unreachable provider or a failed pool read
 *     all yield an **empty** point list — never an exception;
 *   - only a programming error (invalid input) throws;
 *   - the points come back **chronologically ascending** and
 *     de-duplicated, because `lightweight-charts` rejects unsorted
 *     data.
 *
 * Everything here is network-free: the adapter and the market-data
 * provider are both stubs.
 */

import { describe, expect, it } from 'vitest';

import {
  GetPoolTvlHistoryUseCase,
  normalizeTvlPoints,
} from '@core/application/use_cases';
import { InvalidUseCaseInputError } from '@core/application/errors/invalid_input_error';
import type { IProtocolAdapter } from '@core/adapters/protocol_adapter.interface';
import type { IMarketDataProvider } from '@core/providers/market';
import type { TAddress, TPoolTvlPoint } from '@core/shared/types';
import { USD_DECIMALS } from '@core/shared/utils';

import { createStubProtocolAdapter } from '../../_fixtures/stub_protocol_adapter';
import { createStubMarketDataProvider } from '../../_fixtures/stub_market_data_provider';

// ---------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------

const CHAIN_ID = 8453;
const PROTOCOL_ID = 'uniswap-v3';

const POOL = '0x00000000000000000000000000000000000000a1' as TAddress;
const USDC = '0x00000000000000000000000000000000000000b1' as TAddress;
const WETH = '0x00000000000000000000000000000000000000b2' as TAddress;

/** 500 == 0.05% — the fee tier of the fixture pool. */
const FEE = 500;

/** A fixed clock so every timestamp in the DTO is deterministic. */
const NOW = 1_700_000_000n;

/** Seconds in one day. */
const DAY = 86_400n;

/** The provider's own id for the fixture pool (a DefiLlama UUID). */
const EXTERNAL_POOL_ID = 'b99bcdf5-1350-4269-981e-0e9b5cccb007';

// ---------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------

function buildAdapter(): IProtocolAdapter {
  return createStubProtocolAdapter({
    id: PROTOCOL_ID,
    pool: POOL,
    token0: { address: USDC, symbol: 'USDC', decimals: 6 },
    token1: { address: WETH, symbol: 'WETH', decimals: 18 },
    fee: FEE,
    tickSpacing: 10,
    initialTick: 0,
    initialLiquidity: 1_000_000_000_000_000n,
    latestBlock: 1_000_000n,
  });
}

function buildUseCase(
  adapter: IProtocolAdapter,
  market: IMarketDataProvider,
): GetPoolTvlHistoryUseCase {
  return new GetPoolTvlHistoryUseCase(
    () => adapter,
    market,
    () => NOW,
  );
}

/** A TVL point at `daysAgo` days before the fixture clock. */
function point(daysAgo: number, usd: number): TPoolTvlPoint {
  return {
    timestamp: NOW - BigInt(daysAgo) * DAY,
    tvlUsd: BigInt(Math.round(usd * 10 ** USD_DECIMALS)),
  };
}

/**
 * A provider whose every method throws — the "the market is
 * unreachable" case.
 */
function buildThrowingProvider(): IMarketDataProvider {
  const boom = async (): Promise<never> => {
    throw new Error('network down');
  };

  return {
    id: 'throwing-market-data',
    name: 'Throwing Market Data',
    version: '1',
    getTokenPrices: boom,
    getPoolLiquidity: boom,
    getPoolTvlHistory: boom,
  };
}

// ---------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------

describe('GetPoolTvlHistoryUseCase — tracked pool', () => {
  it('returns the provider history with the pool identity', async () => {
    const { provider } = createStubMarketDataProvider({
      history: [point(2, 1_000), point(1, 1_100), point(0, 1_200)],
    });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({
      pool: POOL,
      chainId: CHAIN_ID,
      protocolId: PROTOCOL_ID,
    });

    expect(dto.pool).toBe(POOL);
    expect(dto.chainId).toBe(CHAIN_ID);
    expect(dto.protocolId).toBe(PROTOCOL_ID);
    expect(dto.timestamp).toBe(NOW);
    expect(dto.points).toHaveLength(3);
    expect(dto.points[0]!.tvlUsd).toBe(1_000_000_000n);
    expect(dto.points[2]!.tvlUsd).toBe(1_200_000_000n);
  });

  it('discovers the external pool id before reading the history', async () => {
    const { provider, liquidityCalls, historyCalls } = createStubMarketDataProvider({
      liquidity: {
        pool: POOL,
        chainId: CHAIN_ID,
        protocolId: PROTOCOL_ID,
        tvlUsd: 1_200_000_000n,
        volume24hUsd: 500_000_000n,
        externalPoolId: EXTERNAL_POOL_ID,
        source: 'defi-llama',
        timestamp: NOW,
      },
      history: [point(0, 1_200)],
    });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    // The natural-key match runs first — that is how the provider
    // learns which pool to fetch the history of.
    expect(liquidityCalls).toHaveLength(1);
    expect(historyCalls).toHaveLength(1);
    expect(liquidityCalls[0]).toEqual([CHAIN_ID, POOL]);
    expect(historyCalls[0]).toEqual([CHAIN_ID, POOL]);
    expect(dto.externalPoolId).toBe(EXTERNAL_POOL_ID);
  });

  it('omits the external pool id when the pool is not matched', async () => {
    const { provider } = createStubMarketDataProvider({ history: [] });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.externalPoolId).toBeUndefined();
    expect(dto.points).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Degradation — the UI hides the series, the use case never throws
// ---------------------------------------------------------------------

describe('GetPoolTvlHistoryUseCase — degradation', () => {
  it('returns an empty point list when the provider has no history', async () => {
    const { provider } = createStubMarketDataProvider({ history: null });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.points).toEqual([]);
    expect(dto.pool).toBe(POOL);
  });

  it('never throws when the provider fails', async () => {
    const useCase = buildUseCase(buildAdapter(), buildThrowingProvider());

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.points).toEqual([]);
    expect(dto.externalPoolId).toBeUndefined();
  });

  it('never throws when the pool state cannot be read', async () => {
    const adapter = buildAdapter();
    const broken: IProtocolAdapter = {
      ...adapter,
      async getPoolState(): Promise<never> {
        throw new Error('rpc down');
      },
    };
    const { provider, historyCalls } = createStubMarketDataProvider({
      history: [point(0, 1_200)],
    });
    const useCase = buildUseCase(broken, provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.points).toEqual([]);
    // Without the state there is no natural key, so no lookup at all.
    expect(historyCalls).toHaveLength(0);
  });

  it('throws only for invalid input', async () => {
    const { provider } = createStubMarketDataProvider({});
    const useCase = buildUseCase(buildAdapter(), provider);

    await expect(
      useCase.execute({ pool: '' as TAddress, chainId: CHAIN_ID }),
    ).rejects.toBeInstanceOf(InvalidUseCaseInputError);

    await expect(
      useCase.execute({ pool: POOL, chainId: 0 }),
    ).rejects.toBeInstanceOf(InvalidUseCaseInputError);

    await expect(
      useCase.execute({ pool: POOL, chainId: 1.5 }),
    ).rejects.toBeInstanceOf(InvalidUseCaseInputError);
  });
});

// ---------------------------------------------------------------------
// Point normalization
// ---------------------------------------------------------------------

describe('normalizeTvlPoints', () => {
  it('sorts the points chronologically', () => {
    const sorted = normalizeTvlPoints([
      { timestamp: 300n, tvlUsd: 3n },
      { timestamp: 100n, tvlUsd: 1n },
      { timestamp: 200n, tvlUsd: 2n },
    ]);

    expect(sorted.map((p) => p.timestamp)).toEqual([100n, 200n, 300n]);
  });

  it('keeps the last reading when a timestamp repeats', () => {
    const sorted = normalizeTvlPoints([
      { timestamp: 100n, tvlUsd: 1n },
      { timestamp: 100n, tvlUsd: 9n },
    ]);

    expect(sorted).toHaveLength(1);
    expect(sorted[0]!.tvlUsd).toBe(9n);
  });

  it('drops negative amounts', () => {
    const sorted = normalizeTvlPoints([
      { timestamp: 100n, tvlUsd: -5n },
      { timestamp: 200n, tvlUsd: 0n },
    ]);

    expect(sorted).toHaveLength(1);
    expect(sorted[0]!.tvlUsd).toBe(0n);
  });

  it('returns [] for an empty input', () => {
    expect(normalizeTvlPoints([])).toEqual([]);
  });
});
