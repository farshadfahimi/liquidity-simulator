// app/core/domains/position/create_position.factory.ts

import { TickRange } from '../../shared/value_objects';
import type { TAddress } from '../../shared/types';
import { Position } from './position.class';

/**
 * Options accepted by {@link createPosition}.
 *
 * Either provide `range: TTickRange` (or `tickLower`/`tickUpper`) plus
 * the resolved `amount0`/`amount1`/`liquidity`, **or** a fully-built
 * `quote: TQuotePosition` (in which case the rest are derived).
 */
export interface ICreatePositionOptions {
  pool: TAddress;
  token0: TAddress;
  token1: TAddress;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
}

/**
 * Construct a {@link Position} from explicit numeric inputs. Used when
 * callers already have amounts and liquidity in hand (e.g. from a
 * quoter call).
 */
export function createPosition(
  options: ICreatePositionOptions,
): Position {
  return new Position(
    options.pool,
    new TickRange(options.tickLower, options.tickUpper),
    options.liquidity,
    options.amount0,
    options.amount1,
    options.token0,
    options.token1,
  );
}
