// app/core/test/application/use_cases/get_pool_tvl.test.ts

/**
 * TVL roadmap slice 3 — `GetPoolTvlUseCase` and the fallback chain.
 *
 * The use case is the heart of the TVL feature: it turns a pool
 * address into a UI-ready liquidity summary, using the best data
 * available and degrading tier by tier (TVL-ROADMAP.md §8):
 *
 *   1. `defi-llama`        — the provider's indexed snapshot.
 *   2. `on-chain-estimates` — virtual reserves valued with **both**
 *                            provider prices.
 *   3. `on-chain-estimates` — virtual reserves valued with **one**
 *                            provider price (the other leg derived
 *                            from the pool's own price ratio), or with
 *                            a stablecoin anchor at $1.00.
 *   4. `token-units`        — no USD valuation at all; the virtual
 *                            reserve legs are still reported.
 *
 * Plus the two sanity clamps:
 *   - an indexed TVL below `on-chain estimate / 50` is stale, so the
 *     on-chain number wins;
 *   - an implied fee APR above 10,000%/yr is clamped to `0n`.
 *
 * Everything is network-free: the adapter and the market-data
 * provider are both stubs.
 *
 * The fixture is a **synthetic** USDC/WETH pool at tick 0 — i.e.
 * `sqrtPriceX96 == 2^96`, so *both* virtual reserve legs equal the
 * liquidity (`1e15` raw each):
 *
 *     amount0 = 1e15 raw USDC (6d)  = 1e9 USDC
 *     amount1 = 1e15 raw WETH (18d) = 1e-3 WETH
 *
 * The raw legs are equal but the decimals differ, so the pool's human
 * price (token1 per token0) is `10^(6-18) == 1e-12`. The fixture is
 * therefore **not** economically consistent — it is a *price-ratio*
 * fixture, not a market fixture. That is deliberate: a ratio of
 * `1e-12` (≠ 1) makes an inverted derivation (multiplying instead of
 * dividing by the pool price) show up as a 24-orders-of-magnitude
 * difference, while every expected value below stays exact (all the
 * divisions are powers of ten).
 *
 * The USD prices are chosen per scenario:
 *
 *   - both legs priced: USDC $1.00, WETH $2,000.00
 *   - one leg priced:   WETH $2,000.00 → USDC derived at $2e-9
 *   - no price at all:  USDC anchored at $1.00 → WETH derived at $1e12
 *
 * Two invariants make those numbers easy to check by hand:
 *
 *   1. A leg's USD value is `raw / 10^decimals × price`.
 *   2. A *balanced* pool has both legs worth the same, so pricing one
 *      leg prices the other identically — that is why the "one leg
 *      priced" and "stablecoin anchor" scenarios yield two equal
 *      legs.
 */

import { describe, expect, it } from 'vitest';

import { GetPoolTvlUseCase } from '@core/application/use_cases';
import { InvalidUseCaseInputError } from '@core/application/errors/invalid_input_error';
import { createAnalyticsEngine } from '@core/domains/analytics';
import type { IProtocolAdapter } from '@core/adapters/protocol_adapter.interface';
import type { IMarketDataProvider } from '@core/providers/market';
import { feeAprFromTurnover } from '@core/math';
import type { TAddress, TPoolLiquidity, TTokenPrice } from '@core/shared/types';
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
const FOO = '0x00000000000000000000000000000000000000c1' as TAddress;
const BAR = '0x00000000000000000000000000000000000000c2' as TAddress;

/** $1.00 at `USD_DECIMALS`. */
const ONE_USD = 10n ** BigInt(USD_DECIMALS);

/** $1.00 at the 1e18 token-price scale. */
const PRICE_ONE_USD = 10n ** 18n;

/** $2,000.00 at the 1e18 token-price scale. */
const PRICE_TWO_THOUSAND_USD = 2000n * PRICE_ONE_USD;

/**
 * The pool's active liquidity. At tick 0 both virtual reserve legs
 * equal this value exactly.
 */
const LIQUIDITY = 1_000_000_000_000_000n;

/** 500 == 0.05% — the fee tier of the fixture pool. */
const FEE = 500;

/** A fixed clock so every timestamp in the DTO is deterministic. */
const NOW = 1_700_000_000n;

// ---------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------

/**
 * The synthetic USDC/WETH pool (token0 = USDC 6d, token1 = WETH 18d,
 * tick 0, fee 0.05%).
 */
function buildAdapter(): IProtocolAdapter {
  return createStubProtocolAdapter({
    id: PROTOCOL_ID,
    pool: POOL,
    token0: { address: USDC, symbol: 'USDC', decimals: 6 },
    token1: { address: WETH, symbol: 'WETH', decimals: 18 },
    fee: FEE,
    tickSpacing: 10,
    initialTick: 0,
    initialLiquidity: LIQUIDITY,
    latestBlock: 1_000_000n,
  });
}

/**
 * The same pool shape, but with two non-stablecoin tokens — used to
 * exercise the `token-units` tier (no price, no stablecoin anchor).
 */
function buildNonStableAdapter(): IProtocolAdapter {
  return createStubProtocolAdapter({
    id: PROTOCOL_ID,
    pool: POOL,
    token0: { address: FOO, symbol: 'FOO', decimals: 18 },
    token1: { address: BAR, symbol: 'BAR', decimals: 18 },
    fee: FEE,
    tickSpacing: 10,
    initialTick: 0,
    initialLiquidity: LIQUIDITY,
    latestBlock: 1_000_000n,
  });
}

function buildUseCase(
  adapter: IProtocolAdapter,
  market: IMarketDataProvider,
): GetPoolTvlUseCase {
  return new GetPoolTvlUseCase(
    () => adapter,
    market,
    createAnalyticsEngine(),
    () => NOW,
  );
}

function price(token: TAddress, usdPrice: bigint): TTokenPrice {
  return {
    token,
    usdPrice,
    confidence: PRICE_ONE_USD,
    timestamp: NOW,
  };
}

function liquidity(overrides: Partial<TPoolLiquidity> = {}): TPoolLiquidity {
  return {
    pool: POOL,
    chainId: CHAIN_ID,
    protocolId: PROTOCOL_ID,
    tvlUsd: 88_992_532_000_000n,
    volume24hUsd: 87_887_325_000_000n,
    externalPoolId: 'b99bcdf5-1350-4269-981e-0e9b5cccb007',
    source: 'defi-llama',
    timestamp: 1_701_644_717n,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Tier 1 — the indexed market value
// ---------------------------------------------------------------------

describe('GetPoolTvlUseCase — tier 1 (indexed)', () => {
  it('returns the provider snapshot when the pool is matched', async () => {
    const { provider } = createStubMarketDataProvider({ liquidity: liquidity() });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({
      pool: POOL,
      chainId: CHAIN_ID,
      protocolId: PROTOCOL_ID,
    });

    expect(dto.source).toBe('defi-llama');
    expect(dto.tvlUsd).toBe(88_992_532_000_000n);
    expect(dto.volume24hUsd).toBe(87_887_325_000_000n);
    expect(dto.externalPoolId).toBe('b99bcdf5-1350-4269-981e-0e9b5cccb007');
    expect(dto.timestamp).toBe(1_701_644_717n);
    expect(dto.protocolId).toBe(PROTOCOL_ID);
    expect(dto.chainId).toBe(CHAIN_ID);
  });

  it('always reports the virtual reserve legs', async () => {
    const { provider } = createStubMarketDataProvider({ liquidity: liquidity() });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    // Tick 0 ⇒ both legs equal the liquidity.
    expect(dto.amount0Raw).toBe(LIQUIDITY);
    expect(dto.amount1Raw).toBe(LIQUIDITY);
  });

  it('falls through to the on-chain estimate when the index has no TVL', async () => {
    const { provider } = createStubMarketDataProvider({
      liquidity: liquidity({ tvlUsd: 0n, volume24hUsd: 0n, source: 'defi-llama' }),
      prices: [price(USDC, PRICE_ONE_USD), price(WETH, PRICE_TWO_THOUSAND_USD)],
    });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.source).toBe('on-chain-estimates');
    // leg0 = 1e9 USDC × $1.00  = $1,000,000,000.00
    // leg1 = 1e-3 WETH × $2,000 = $2.00
    expect(dto.tvlUsd).toBe(1_000_000_002_000_000n);
  });
});

// ---------------------------------------------------------------------
// Tier 2 — virtual reserves valued with both provider prices
// ---------------------------------------------------------------------

describe('GetPoolTvlUseCase — tier 2 (on-chain estimate)', () => {
  it('values both virtual reserve legs with the provider prices', async () => {
    const { provider } = createStubMarketDataProvider({
      prices: [price(USDC, PRICE_ONE_USD), price(WETH, PRICE_TWO_THOUSAND_USD)],
    });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    // Hand-computed at tick 0 (both legs == liquidity == 1e15 raw):
    //   leg0 = 1e15 raw USDC = 1e9 USDC × $1.00  = $1,000,000,000.00
    //   leg1 = 1e15 raw WETH = 1e-3 WETH × $2,000 = $2.00
    expect(dto.source).toBe('on-chain-estimates');
    expect(dto.tvlUsd).toBe(1_000_000_002_000_000n);
    expect(dto.volume24hUsd).toBe(0n);
  });

  it('derives the unpriced leg from the pool price ratio', async () => {
    // Only token1 is priced: token0 = token1 × pool price.
    const { provider } = createStubMarketDataProvider({
      prices: [price(WETH, PRICE_TWO_THOUSAND_USD)],
    });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    // The pool price is 1e-12 (token1 per token0), so the derived
    // USDC price is $2,000 × 1e-12 = $2e-9:
    //   leg0 = 1e9 USDC × $2e-9 = $2.00
    //   leg1 = 1e-3 WETH × $2,000 = $2.00
    // Both legs are worth the same — the pool is balanced.
    expect(dto.source).toBe('on-chain-estimates');
    expect(dto.tvlUsd).toBe(4_000_000n);
  });

  it('anchors a stablecoin leg at $1.00 when the provider has no prices', async () => {
    const { provider } = createStubMarketDataProvider({});
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    // token0 (USDC) is anchored at $1.00; the WETH leg follows from
    // the pool price (1e-12 ⇒ $1e12 per WETH):
    //   leg0 = 1e9 USDC × $1.00 = $1,000,000,000.00
    //   leg1 = 1e-3 WETH × $1e12 = $1,000,000,000.00
    expect(dto.source).toBe('on-chain-estimates');
    expect(dto.tvlUsd).toBe(2_000_000_000_000_000n);
  });

  it('reports token units only when no USD valuation is possible', async () => {
    const { provider } = createStubMarketDataProvider({});
    const useCase = buildUseCase(buildNonStableAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.source).toBe('token-units');
    expect(dto.tvlUsd).toBe(0n);
    expect(dto.volume24hUsd).toBe(0n);
    expect(dto.feeApr).toBe(0n);
    expect(dto.positionShare).toBe(0n);
    // The legs are still there — that is the whole point of tier 4.
    expect(dto.amount0Raw).toBe(LIQUIDITY);
    expect(dto.amount1Raw).toBe(LIQUIDITY);
  });
});

// ---------------------------------------------------------------------
// Sanity clamps
// ---------------------------------------------------------------------

describe('GetPoolTvlUseCase — sanity clamps', () => {
  it('prefers the on-chain estimate when the index looks stale', async () => {
    // The index says $1.00 — far below the on-chain estimate / 50
    // (the estimate is ~$1e9, so the threshold is ~$20,000,000).
    const { provider } = createStubMarketDataProvider({
      liquidity: liquidity({ tvlUsd: ONE_USD }),
      prices: [price(USDC, PRICE_ONE_USD), price(WETH, PRICE_TWO_THOUSAND_USD)],
    });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.source).toBe('on-chain-estimates');
    expect(dto.tvlUsd).toBe(1_000_000_002_000_000n);
  });

  it('keeps the indexed value when it is within the staleness band', async () => {
    // The index says $50,000,000 — well above `estimate / 50`
    // (~$20,000,000).
    const { provider } = createStubMarketDataProvider({
      liquidity: liquidity({ tvlUsd: 50_000_000n * ONE_USD }),
      prices: [price(USDC, PRICE_ONE_USD), price(WETH, PRICE_TWO_THOUSAND_USD)],
    });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.source).toBe('defi-llama');
    expect(dto.tvlUsd).toBe(50_000_000n * ONE_USD);
  });

  it('clamps an implausible fee APR to zero', async () => {
    // $1,000,000 of volume against $100 of TVL ⇒ ~182,500%/yr.
    // The non-stable pool keeps the *indexed* tier (no on-chain
    // estimate to compare against), so the clamp is what zeroes
    // the APR — not a missing turnover.
    const { provider } = createStubMarketDataProvider({
      liquidity: liquidity({
        tvlUsd: 100n * ONE_USD,
        volume24hUsd: 1_000_000n * ONE_USD,
      }),
    });
    const useCase = buildUseCase(buildNonStableAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.source).toBe('defi-llama');
    expect(dto.feeApr).toBe(0n);
  });

  it('clamps at exactly 10,000%/yr, not at 1,000,000%/yr', async () => {
    // APR = (volume / tvl) × 0.05% × 365.
    //   500× turnover ⇒  9,125%/yr → kept
    //   600× turnover ⇒ 10,950%/yr → clamped
    // The threshold is 100 × APR_SCALE (APR_SCALE is 1e18 == 100%),
    // so a 10,000× threshold would wrongly keep the second number.
    const tvl = 1_000_000n * ONE_USD;

    const kept = await buildUseCase(
      buildNonStableAdapter(),
      createStubMarketDataProvider({
        liquidity: liquidity({
          tvlUsd: tvl,
          volume24hUsd: 500n * tvl,
        }),
      }).provider,
    ).execute({ pool: POOL, chainId: CHAIN_ID });

    // 9,125%/yr == 91.25 × APR_SCALE (APR_SCALE is 1e18 == 100%).
    expect(kept.feeApr).toBe(91_250n * PRICE_ONE_USD / 1_000n);

    const clamped = await buildUseCase(
      buildNonStableAdapter(),
      createStubMarketDataProvider({
        liquidity: liquidity({
          tvlUsd: tvl,
          volume24hUsd: 600n * tvl,
        }),
      }).provider,
    ).execute({ pool: POOL, chainId: CHAIN_ID });

    expect(clamped.feeApr).toBe(0n);
  });
});

// ---------------------------------------------------------------------
// Fee APR + position share
// ---------------------------------------------------------------------

describe('GetPoolTvlUseCase — fee APR and position share', () => {
  it('computes the fee APR exactly like the slice-0 util', async () => {
    const { provider } = createStubMarketDataProvider({ liquidity: liquidity() });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.feeApr).toBe(
      feeAprFromTurnover(87_887_325_000_000n, 88_992_532_000_000n, 0.0005),
    );
    // ~18% — a plausible number for a 0.05% tier.
    expect(dto.feeApr).toBeGreaterThan(0n);
    expect(dto.feeApr).toBeLessThan(200_000_000_000_000_000n);
  });

  it('reports no fee APR when the turnover is unknown', async () => {
    const { provider } = createStubMarketDataProvider({
      liquidity: liquidity({ volume24hUsd: 0n }),
    });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.feeApr).toBe(0n);
  });

  it('computes the deposit share of the pool', async () => {
    const { provider } = createStubMarketDataProvider({ liquidity: liquidity() });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({
      pool: POOL,
      chainId: CHAIN_ID,
      notionalUsd: 8_899_253_200_000n, // 10% of the indexed TVL
    });

    expect(dto.positionShare).toBe(100_000_000_000_000_000n); // 10% at 1e18
  });

  it('reports no share when no notional was supplied', async () => {
    const { provider } = createStubMarketDataProvider({ liquidity: liquidity() });
    const useCase = buildUseCase(buildAdapter(), provider);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.positionShare).toBe(0n);
  });
});

// ---------------------------------------------------------------------
// Validation + degradation
// ---------------------------------------------------------------------

describe('GetPoolTvlUseCase — validation and degradation', () => {
  it('rejects a missing pool address', async () => {
    const { provider } = createStubMarketDataProvider({});
    const useCase = buildUseCase(buildAdapter(), provider);

    await expect(
      useCase.execute({ pool: '' as TAddress, chainId: CHAIN_ID }),
    ).rejects.toBeInstanceOf(InvalidUseCaseInputError);
  });

  it('rejects an invalid chain id', async () => {
    const { provider } = createStubMarketDataProvider({});
    const useCase = buildUseCase(buildAdapter(), provider);

    await expect(
      useCase.execute({ pool: POOL, chainId: 0 }),
    ).rejects.toBeInstanceOf(InvalidUseCaseInputError);
  });

  it('rejects a negative notional', async () => {
    const { provider } = createStubMarketDataProvider({});
    const useCase = buildUseCase(buildAdapter(), provider);

    await expect(
      useCase.execute({ pool: POOL, chainId: CHAIN_ID, notionalUsd: -1n }),
    ).rejects.toBeInstanceOf(InvalidUseCaseInputError);
  });

  it('never throws when the provider blows up', async () => {
    const broken: IMarketDataProvider = {
      id: 'broken',
      name: 'Broken',
      version: '0',
      async getTokenPrices() {
        throw new Error('network down');
      },
      async getPoolLiquidity() {
        throw new Error('network down');
      },
      async getPoolTvlHistory() {
        throw new Error('network down');
      },
    };
    const useCase = buildUseCase(buildNonStableAdapter(), broken);

    const dto = await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(dto.source).toBe('token-units');
    expect(dto.tvlUsd).toBe(0n);
    expect(dto.amount0Raw).toBe(LIQUIDITY);
  });

  it('asks the provider for exactly one pool and one price batch', async () => {
    const stub = createStubMarketDataProvider({ liquidity: liquidity() });
    const useCase = buildUseCase(buildAdapter(), stub.provider);

    await useCase.execute({ pool: POOL, chainId: CHAIN_ID });

    expect(stub.liquidityCalls).toHaveLength(1);
    expect(stub.liquidityCalls[0]?.[0]).toBe(CHAIN_ID);
    expect(stub.liquidityCalls[0]?.[1]).toBe(POOL);
    expect(stub.priceCalls).toHaveLength(1);
    expect(stub.priceCalls[0]?.[1]).toEqual([USDC, WETH]);
  });
});
