// app/core/adapters/types/quote_position.type.ts

import type { TAddress } from '@core/shared/types';
import type { TTickRange } from './tick_range.type';

/**
 * Protocol-neutral quote for a hypothetical LP position:
 * given an amount of `token0` deposited and a tick range, how many
 * `token1` are required, and what liquidity / amounts does that produce?
 */
export interface TQuotePosition {
  token0Amount: bigint;

  token1Amount: bigint;

  liquidity: bigint;

  tickLower: number;

  tickUpper: number;

  pool: TAddress;

  token0: TAddress;

  token1: TAddress;
}

export type { TTickRange };
