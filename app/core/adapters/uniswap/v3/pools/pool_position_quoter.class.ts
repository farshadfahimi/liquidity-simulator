// app/core/adapters/uniswap/v3/pools/pool_position_quoter.class.ts

import { Token } from '@uniswap/sdk-core';
import { nearestUsableTick, Pool, Position } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';

import type { TPoolState } from '@core/adapters/types';
import type { TQuotePosition } from '@core/adapters/types';
import type { TTickRange } from '@core/adapters/types';

/**
 * Computes the token amounts a position would hold given a pool state
 * and a `token0Amount` deposit. Uses @uniswap/v3-sdk's Position math
 * (Position.fromAmount0 + Position.mintAmounts) so we don't reinvent
 * CL math.
 *
 * Tick bounds are auto-aligned to the pool's tickSpacing (V3 invariant
 * requires `tickLower % tickSpacing === 0`); callers may pass any
 * human-friendly range.
 *
 * This class is pure (no RPC, no clock) — callers feed in a fresh
 * `TPoolState`.
 */
export class UniswapV3PoolPositionQuoter {
  constructor(private readonly chainId: number) {}

  quote(
    state: TPoolState,
    range: TTickRange,
    token0Amount: bigint,
  ): TQuotePosition {
    const token0 = new Token(
      this.chainId,
      state.token0.address,
      state.token0.decimals,
      state.token0.symbol,
      state.token0.name,
    );
    const token1 = new Token(
      this.chainId,
      state.token1.address,
      state.token1.decimals,
      state.token1.symbol,
      state.token1.name,
    );

    const pool = new Pool(
      token0,
      token1,
      state.fee as 100 | 500 | 3000 | 10000,
      JSBI.BigInt(state.sqrtPriceX96.toString()),
      JSBI.BigInt(state.liquidity.toString()),
      state.tick,
    );

    const tickLower = nearestUsableTick(range.tickLower, state.tickSpacing);
    const tickUpper = nearestUsableTick(range.tickUpper, state.tickSpacing);

    const amount0 = JSBI.BigInt(token0Amount.toString());

    const fromAmount0 = Position.fromAmount0({
      pool,
      tickLower,
      tickUpper,
      amount0,
    });

    const position = new Position({
      pool,
      liquidity: fromAmount0.liquidity,
      tickLower,
      tickUpper,
    });

    return {
      token0Amount: BigInt(position.mintAmounts.amount0.toString()),
      token1Amount: BigInt(position.mintAmounts.amount1.toString()),
      liquidity: BigInt(position.liquidity.toString()),
      tickLower,
      tickUpper,
      pool: state.pool,
      token0: state.token0.address,
      token1: state.token1.address,
    };
  }
}
