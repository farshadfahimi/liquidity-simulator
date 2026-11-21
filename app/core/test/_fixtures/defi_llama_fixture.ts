// app/core/test/_fixtures/defi_llama_fixture.ts
//
// Sample payloads of the three DefiLlama endpoints, copied from
// TVL-ROADMAP.md §3.2 / §3.3 / §3.4 (verified live on 2026-11-18).
//
// They are used to stub `fetchImpl` in the provider tests, so the
// tests exercise the *real* payload shapes without touching the
// network. The numbers are the ones DefiLlama actually returned —
// including the float precision that makes the bigint conversion
// interesting (`0.9998438664500001`, `87887325.21365`).

import type { TAddress } from '@core/shared/types';

/** Base WETH — the roadmap's E1/E2 sample. */
export const BASE_WETH = '0x4200000000000000000000000000000000000006' as TAddress;

/** Base USDC — the roadmap's E1/E2 sample. */
export const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54da02913' as TAddress;

/** Sonic USDC — the roadmap's E1 sample. */
export const SONIC_USDC = '0x29219dd400f2bf60e5a23d13be72b486d4038894' as TAddress;

/**
 * The second token of the synthetic Shadow pair. DefiLlama's index
 * carries no addresses, so the fixture only needs *a* second
 * address — this one is deliberately synthetic.
 */
export const SHADOW_TOKEN = '0x0000000000000000000000000000000000000abc' as TAddress;

/** Our (synthetic) address of the Base WETH/USDC 0.3 % pool. */
export const BASE_WETH_USDC_POOL = '0x1111111111111111111111111111111111111111' as TAddress;

/** Our (synthetic) address of the Shadow pool. */
export const SHADOW_POOL = '0x2222222222222222222222222222222222222222' as TAddress;

/** DefiLlama's UUID for the Base WETH/USDC 0.3 % pool. */
export const BASE_WETH_USDC_POOL_ID = 'b99bcdf5-1350-4269-981e-0e9b5cccb007';

/** DefiLlama's UUID for the Shadow pool. */
export const SHADOW_POOL_ID = '3a1f2c44-9d5e-4f0b-8a77-6c1e2b3d4e5f';

/**
 * E1 — `coins.llama.fi/prices/current/…`.
 *
 * Note the two chains in one payload: the provider only accepts the
 * entries that belong to the chain it asked for.
 */
export const DEFI_LLAMA_E1_SAMPLE = {
  coins: {
    'sonic:0x29219dd400f2bf60e5a23d13be72b486d4038894': {
      decimals: 6,
      symbol: 'USDC',
      price: 0.9998438664500001,
      timestamp: 1794998447,
      confidence: 0.999,
    },
    'base:0x4200000000000000000000000000000000000006': {
      decimals: 18,
      symbol: 'WETH',
      price: 1797.0162017200657,
      timestamp: 1794998399,
      confidence: 0.99,
    },
  },
};

/**
 * E2 — `yields.llama.fi/pools` (trimmed to the fields we read).
 *
 * Three entries:
 *   - the Base WETH/USDC 0.3 % pool (an APY `outlier` — its TVL is
 *     still perfectly usable),
 *   - a Shadow pool whose `poolMeta` carries the `CL ` prefix,
 *   - a pool of a project we don't support (must be ignored).
 */
export const DEFI_LLAMA_E2_SAMPLE = {
  status: 'success',
  data: [
    {
      chain: 'Base',
      project: 'uniswap-v3',
      symbol: 'WETH-USDC',
      tvlUsd: 88992532,
      apyBase: 90.11676,
      apyReward: null,
      apy: 90.11676,
      pool: BASE_WETH_USDC_POOL_ID,
      outlier: true,
      poolMeta: '0.3%',
      underlyingTokens: [
        '0x4200000000000000000000000000000000000006',
        '0x833589fcd6edb6e08f4c7c32d4f71b54da02913',
      ],
      volumeUsd1d: 87887325.21365,
      volumeUsd7d: null,
    },
    {
      chain: 'Sonic',
      project: 'shadow-exchange-clmm',
      symbol: 'USDC-SHADOW',
      tvlUsd: 1234567.89,
      apyBase: 12.5,
      apy: 12.5,
      pool: SHADOW_POOL_ID,
      outlier: false,
      poolMeta: 'CL 0.24%',
      underlyingTokens: [
        '0x29219dd400f2bf60e5a23d13be72b486d4038894',
        '0x0000000000000000000000000000000000000abc',
      ],
      volumeUsd1d: null,
      volumeUsd7d: null,
    },
    {
      chain: 'Ethereum',
      project: 'aave-v3',
      symbol: 'USDC-AAVE',
      tvlUsd: 999999,
      apyBase: 3.1,
      apy: 3.1,
      pool: '00000000-0000-0000-0000-000000000000',
      outlier: false,
      poolMeta: '0.05%',
      underlyingTokens: [
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
      ],
      volumeUsd1d: 4242,
      volumeUsd7d: null,
    },
  ],
};

/**
 * E3 — `yields.llama.fi/chart/{poolId}`.
 *
 * The roadmap's first point plus one more, so the test can assert
 * on the ISO → unix-seconds conversion.
 */
export const DEFI_LLAMA_E3_SAMPLE = {
  status: 'success',
  data: [
    {
      timestamp: '2023-12-03T23:05:17.943Z',
      tvlUsd: 1002,
      apy: 5.42842,
      apyBase: 5.42842,
      apyReward: null,
      il7d: -0.3149,
      apyBase7d: 0.04749,
      pricePerShare: null,
    },
    {
      timestamp: '2023-12-04T23:05:17.943Z',
      tvlUsd: 1500.5,
      apy: 5.1,
      apyBase: 5.1,
      apyReward: null,
      il7d: -0.2,
      apyBase7d: 0.04,
      pricePerShare: null,
    },
  ],
};
