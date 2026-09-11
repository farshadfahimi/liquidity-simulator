// app/core/adapters/types/pool_state.type.ts

import type { TAddress } from '@core/shared/types';
import type { TToken } from '@core/shared/types';

/**
 * Live, protocol-neutral snapshot of a pool's on-chain state. sqrtPriceX96
 * is the canonical CL representation; everything downstream (Core math,
 * UI) only consumes this shape.
 */
export interface TPoolState {
  pool: TAddress;

  token0: TToken;

  token1: TToken;

  fee: number;

  tickSpacing: number;

  sqrtPriceX96: bigint;

  tick: number;

  liquidity: bigint;

  feeGrowthGlobal0X128: bigint;

  feeGrowthGlobal1X128: bigint;
}
