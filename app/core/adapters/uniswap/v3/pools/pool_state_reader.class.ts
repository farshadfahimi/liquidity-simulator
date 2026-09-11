// app/core/adapters/uniswap/v3/pools/pool_state_reader.class.ts

import { nearestUsableTick } from '@uniswap/v3-sdk';

import type { IRpcProvider } from '@core/providers/rpc';

import { uniswapV3PoolAbi } from '../abi/uniswap_v3_pool.abi';
import type { TAddress } from '@core/shared/types';
import type { TToken } from '@core/shared/types';
import type { TPoolState } from '@core/adapters/types';
import type { TTick } from '@core/adapters/types';
import type { TTickRange } from '@core/adapters/types';
import { UniswapV3TokenResolver } from '../tokens/token_resolver.class';

/**
 * Translates raw Uniswap V3 on-chain state into the protocol-neutral
 * `TPoolState` / `TTick` shapes used by the rest of Core. This is the
 * single place that knows how a V3 pool encodes its state.
 */
export class UniswapV3PoolStateReader {
  constructor(
    private readonly rpc: IRpcProvider,
    private readonly tokens: UniswapV3TokenResolver,
  ) {}

  async readMetadata(
    pool: TAddress,
  ): Promise<{
    token0: TAddress;
    token1: TAddress;
    fee: number;
    tickSpacing: number;
  }> {
    const [token0, token1, fee, tickSpacing] = await this.rpc.multicall<
      TAddress | number
    >([
      { address: pool, abi: uniswapV3PoolAbi, functionName: 'token0' },
      { address: pool, abi: uniswapV3PoolAbi, functionName: 'token1' },
      { address: pool, abi: uniswapV3PoolAbi, functionName: 'fee' },
      { address: pool, abi: uniswapV3PoolAbi, functionName: 'tickSpacing' },
    ]);

    return {
      token0: token0 as TAddress,
      token1: token1 as TAddress,
      fee: Number(fee),
      tickSpacing: Number(tickSpacing),
    };
  }

  async readState(
    pool: TAddress,
    token0: TToken,
    token1: TToken,
    fee: number,
    tickSpacing: number,
  ): Promise<TPoolState> {
    const [
      slot0,
      liquidity,
      feeGrowthGlobal0X128,
      feeGrowthGlobal1X128,
    ] = await this.rpc.multicall<bigint | number | readonly [bigint, number]>(
      [
        {
          address: pool,
          abi: uniswapV3PoolAbi,
          functionName: 'slot0',
        },
        {
          address: pool,
          abi: uniswapV3PoolAbi,
          functionName: 'liquidity',
        },
        {
          address: pool,
          abi: uniswapV3PoolAbi,
          functionName: 'feeGrowthGlobal0X128',
        },
        {
          address: pool,
          abi: uniswapV3PoolAbi,
          functionName: 'feeGrowthGlobal1X128',
        },
      ],
    );

    // `slot0` is encoded by viem as a tuple struct; we accept it as a
    // positional array here so we stay protocol-neutral and don't leak
    // viem's typed return shapes.
    const slot = slot0 as readonly unknown[];
    const sqrtPriceX96 = BigInt(slot[0] as bigint);
    const tick = Number(slot[1] as number);

    return {
      pool,
      token0,
      token1,
      fee,
      tickSpacing,
      sqrtPriceX96,
      tick,
      liquidity: BigInt(liquidity as bigint),
      feeGrowthGlobal0X128: BigInt(feeGrowthGlobal0X128 as bigint),
      feeGrowthGlobal1X128: BigInt(feeGrowthGlobal1X128 as bigint),
    };
  }

  async readFullState(pool: TAddress): Promise<TPoolState> {
    const meta = await this.readMetadata(pool);
    const [tokenA, tokenB] = await this.tokens.resolveMany([
      meta.token0,
      meta.token1,
    ]);
    // Pool addresses that V3 returns are guaranteed to be sorted, but
    // we resolve meta.token0 first and reuse it.
    return this.readState(
      pool,
      tokenA!,
      tokenB!,
      meta.fee,
      meta.tickSpacing,
    );
  }

  async readTicks(
    pool: TAddress,
    range: TTickRange,
    tickSpacing: number,
  ): Promise<readonly TTick[]> {
    const alignedLower = nearestUsableTick(range.tickLower, tickSpacing);
    const alignedUpper = nearestUsableTick(range.tickUpper, tickSpacing);

    if (alignedLower >= alignedUpper) {
      return [];
    }

    const tickIndices: number[] = [];
    for (let i = alignedLower; i <= alignedUpper; i += tickSpacing) {
      tickIndices.push(i);
    }

    const calls = tickIndices.map((tick) => ({
      address: pool,
      abi: uniswapV3PoolAbi,
      functionName: 'ticks',
      args: [tick],
    }));

    const results = await this.rpc.multicall<readonly [bigint, bigint]>(calls);

    return tickIndices.map((index, i) => {
      const tuple = results[i] as readonly [bigint, bigint];
      return {
        index,
        liquidityGross: BigInt(tuple[0]),
        liquidityNet: BigInt(tuple[1]),
      };
    });
  }
}
