// app/core/adapters/shadow/pools/pool_state_reader.class.ts

import { nearestUsableTick } from '@uniswap/v3-sdk';

import type { IRpcProvider } from '@core/providers/rpc';

import { shadowV3PoolAbi } from '../abi/shadow_v3_pool.abi';
import type { TAddress } from '@core/shared/types';
import type { TPoolState } from '@core/adapters/types';
import type { TTick } from '@core/adapters/types';
import type { TTickRange } from '@core/adapters/types';
import type { TToken } from '@core/shared/types';
import { ShadowTokenResolver } from '../tokens/token_resolver.class';

/**
 * Translates raw Shadow CL pool state into the protocol-neutral
 * `TPoolState` / `TTick` shapes. Shadow's storage layout mirrors
 * Uniswap V3, so the read paths are identical.
 */
export class ShadowPoolStateReader {
  constructor(
    private readonly rpc: IRpcProvider,
    private readonly tokens: ShadowTokenResolver,
  ) {}

  async readMetadata(pool: TAddress): Promise<{
    token0: TAddress;
    token1: TAddress;
    fee: number;
    tickSpacing: number;
  }> {
    const [token0, token1, fee, tickSpacing] = await this.rpc.multicall<
      TAddress | number
    >([
      { address: pool, abi: shadowV3PoolAbi, functionName: 'token0' },
      { address: pool, abi: shadowV3PoolAbi, functionName: 'token1' },
      { address: pool, abi: shadowV3PoolAbi, functionName: 'fee' },
      { address: pool, abi: shadowV3PoolAbi, functionName: 'tickSpacing' },
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
    ] = await this.rpc.multicall<bigint | number | readonly unknown[]>([
      { address: pool, abi: shadowV3PoolAbi, functionName: 'slot0' },
      { address: pool, abi: shadowV3PoolAbi, functionName: 'liquidity' },
      {
        address: pool,
        abi: shadowV3PoolAbi,
        functionName: 'feeGrowthGlobal0X128',
      },
      {
        address: pool,
        abi: shadowV3PoolAbi,
        functionName: 'feeGrowthGlobal1X128',
      },
    ]);

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
    return this.readState(
      pool,
      tokenA!,
      tokenB!,
      meta.fee,
      meta.tickSpacing,
    );
  }

  /**
   * Read pool state pinned to a specific historical block. Only
   * fetches `slot0`; metadata is constant for a pool. Public RPCs
   * without archive state will throw — the caller treats that as
   * a signal to fall back to a synthetic history.
   */
  async readStateAtBlock(
    pool: TAddress,
    blockNumber: bigint,
  ): Promise<{ tick: number; sqrtPriceX96: bigint }> {
    const [slot0] = await this.rpc.multicall<
      readonly unknown[]
    >(
      [
        {
          address: pool,
          abi: shadowV3PoolAbi,
          functionName: 'slot0',
          blockTag: blockNumber,
        },
      ],
    );

    const slot = slot0 as readonly unknown[];
    const sqrtPriceX96 = BigInt(slot[0] as bigint);
    const tick = Number(slot[1] as number);

    return { tick, sqrtPriceX96 };
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
      abi: shadowV3PoolAbi,
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
