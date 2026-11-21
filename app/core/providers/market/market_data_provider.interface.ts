// app/core/providers/market/market_data_provider.interface.ts

import type { TAddress } from '@core/shared/types';
import type { TTokenPrice } from '@core/shared/types';
import type { TPoolLiquidity } from '@core/shared/types';
import type { TPoolTvlPoint } from '@core/shared/types';

/**
 * Market-data provider: the third kind of provider in the Core
 * (besides RPC and history).
 *
 * Where an RPC provider answers *"what does the chain say?"* and a
 * history provider answers *"what did the chain say yesterday?"*, a
 * market-data provider answers *"what does the wider market say?"* —
 * USD prices, TVL, trading volume — sourced from an external
 * aggregator.
 *
 * Contract (TVL-ROADMAP §8): **providers never throw for "data
 * unavailable"**. They return `null` / `[]` and the caller decides
 * what to do (usually: fall back to the next tier). Throwing is
 * reserved for programming errors (invalid constructor inputs).
 */
export interface IMarketDataProvider {
  /** Stable id of the implementation (e.g. `defi-llama`). */
  readonly id: string;

  /** Human-readable name of the implementation. */
  readonly name: string;

  /** Version of the implementation. */
  readonly version: string;

  /**
   * USD prices for `tokens` on `chainId`.
   *
   * Tokens the provider doesn't know are simply **omitted** from the
   * result — never an error.
   *
   * @param chainId - Chain the tokens live on.
   * @param tokens - Token addresses to price.
   * @returns One entry per known token (at 1e18 price scale).
   */
  getTokenPrices(
    chainId: number,
    tokens: readonly TAddress[],
  ): Promise<readonly TTokenPrice[]>;

  /**
   * Liquidity snapshot for one pool.
   *
   * @param chainId - Chain the pool lives on.
   * @param protocolId - Our protocol id (`uniswap-v3`, `shadow-cl`).
   * @param pool - The pool address.
   * @param token0 - First token of the pair.
   * @param token1 - Second token of the pair.
   * @param fee - Fee tier in hundredths of a basis point (500 = 0.05%).
   * @returns The snapshot, or `null` when the pool isn't tracked.
   */
  getPoolLiquidity(
    chainId: number,
    protocolId: string,
    pool: TAddress,
    token0: TAddress,
    token1: TAddress,
    fee: number,
  ): Promise<TPoolLiquidity | null>;

  /**
   * Daily TVL history for one pool.
   *
   * @param chainId - Chain the pool lives on.
   * @param pool - The pool address.
   * @returns The history, or `null` when the pool isn't tracked.
   */
  getPoolTvlHistory(
    chainId: number,
    pool: TAddress,
  ): Promise<readonly TPoolTvlPoint[] | null>;
}
