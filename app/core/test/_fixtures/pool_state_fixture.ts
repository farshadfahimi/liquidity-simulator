// app/core/test/_fixtures/pool_state_fixture.ts
//
// Builder for synthetic `TPoolState` objects — the offline twin of a
// live pool read. Used by the TVL tests (virtual reserves, on-chain
// TVL, position share) so they never touch a network.
//
// The defaults model a USDC/WETH-style pool: token0 with 6 decimals,
// token1 with 18 decimals, tick 0. At tick 0 the *raw* ratio is 1:1
// (sqrtPriceX96 == 2^96), which makes every expected value in the
// tests hand-computable:
//
//   amount0Raw = L × 2^96 / 2^96 = L
//   amount1Raw = L × 2^96 / 2^96 = L
//
// The human price (token1 per token0) at tick 0 is therefore
// 10^(d0 − d1) = 1e-12 for the default decimals — i.e. 1 USDC buys
// 1e-12 WETH, which is the correct direction for a USDC/WETH pool.

import { sqrtRatioAtTick } from '@core/math';
import type { TPoolState } from '@core/adapters/types/pool_state.type';
import type { TAddress } from '@core/shared/types';

/** Minimal token description carried by `TPoolState`. */
export interface IStubStateToken {
  readonly address: TAddress;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

/** Options accepted by {@link buildPoolState}. */
export interface IPoolStateFixtureOptions {
  readonly pool?: TAddress;
  readonly token0?: IStubStateToken;
  readonly token1?: IStubStateToken;
  readonly fee?: number;
  readonly tickSpacing?: number;
  readonly tick?: number;
  readonly liquidity?: bigint;
  readonly sqrtPriceX96?: bigint;
}

/** Stub USDC (6 decimals). */
export const STUB_USDC: IStubStateToken = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as TAddress,
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
};

/** Stub WETH (18 decimals). */
export const STUB_WETH: IStubStateToken = {
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as TAddress,
  symbol: 'WETH',
  name: 'Wrapped Ether',
  decimals: 18,
};

/** Default pool address for the fixture. */
export const STUB_POOL = '0x000000000000000000000000000000000000dEaD' as TAddress;

/** Default liquidity: 1e12 (small enough to keep the numbers sane). */
export const STUB_LIQUIDITY = 1_000_000_000_000n;

/**
 * Build a synthetic `TPoolState`. Every field has a deterministic
 * default; override only what a test cares about.
 */
export function buildPoolState(
  options: IPoolStateFixtureOptions = {},
): TPoolState {
  const tick = options.tick ?? 0;

  return {
    pool: options.pool ?? STUB_POOL,
    token0: options.token0 ?? STUB_USDC,
    token1: options.token1 ?? STUB_WETH,
    fee: options.fee ?? 500,
    tickSpacing: options.tickSpacing ?? 10,
    sqrtPriceX96: options.sqrtPriceX96 ?? sqrtRatioAtTick(tick),
    tick,
    liquidity: options.liquidity ?? STUB_LIQUIDITY,
    feeGrowthGlobal0X128: 0n,
    feeGrowthGlobal1X128: 0n,
  };
}
