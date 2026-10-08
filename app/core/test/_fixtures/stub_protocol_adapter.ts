// app/core/test/_fixtures/stub_protocol_adapter.ts
//
// In-memory IProtocolAdapter stub for unit tests. Implements
// just enough of the contract to drive `GetPoolHistoryUseCase`
// end-to-end without touching a real chain. The stub's
// `getPoolStateAtBlock(pool, blockNumber)` returns a
// `TPoolState` whose `tick` is derived from a deterministic
// random walk anchored at `initialTick`, so the on-chain path
// produces a *non-flat* price series and the resulting
// `IHistorySnapshotDTO` stream has meaningful OHLC spread for
// the candle aggregator to chew on.
//
// Everything outside the history path (`discoverPools`,
// `getTicks`, `quotePosition`) throws on purpose so a test
// that accidentally calls into them surfaces the misuse.

import { sqrtRatioAtTick } from '@core/math';
import type { IProtocolAdapter } from '@core/adapters/protocol_adapter.interface';
import type { TPoolState } from '@core/adapters/types/pool_state.type';
import type { TTickRange } from '@core/adapters/types/tick_range.type';
import type { TAddress } from '@core/shared/types';

export interface IStubPoolToken {
  readonly address: TAddress;
  readonly symbol: string;
  readonly decimals: number;
}

export interface IStubAdapterOptions {
  readonly id?: string;
  readonly name?: string;
  readonly version?: string;
  readonly pool: TAddress;
  readonly token0: IStubPoolToken;
  readonly token1: IStubPoolToken;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly initialTick: number;
  readonly initialLiquidity?: bigint;
  /**
   * Per-block tick delta. Each call to `getPoolStateAtBlock`
   * adds `tickDeltaPerBlock * blocksAgo` to the initial tick,
   * so a block N steps back has tick `initialTick - N *
   * tickDeltaPerBlock`. Positive delta means price rises as we
   * walk forward (newer block = higher tick).
   *
   * Default: 1 (a one-tick-per-block walk — small enough to
   * stay numerically well-behaved, large enough that the
   * `isFlatSeries` 5bps gate passes after a few blocks).
   */
  readonly tickDeltaPerBlock?: number;
  /**
   * The block number the stub treats as "the head". Each
   * `getPoolStateAtBlock(_, N)` call returns tick
   * `initialTick - (head - N) * tickDeltaPerBlock`, so a
   * block N steps *behind* the head has a *lower* tick. This
   * is the contract the history use case expects: the
   * `latestBlock` (from `rpc.getBlockNumber()`) is the
   * freshest state, older blocks have older prices.
   */
  readonly latestBlock: bigint;
}

const DEFAULT_LIQUIDITY = 1_000_000_000_000_000_000n;

/**
 * Build a `IProtocolAdapter` whose `getPoolState` returns the
 * latest (newest) state and `getPoolStateAtBlock` returns a
 * state pinned to that block with a tick offset that grows
 * linearly with how far back the block is. The result is a
 * monotonic, non-flat price series that's easy for the
 * aggregator to reason about and that the use case's
 * `isFlatSeries` gate will *not* trip.
 */
export function createStubProtocolAdapter(
  options: IStubAdapterOptions,
): IProtocolAdapter {
  const tickDeltaPerBlock = options.tickDeltaPerBlock ?? 1;
  const liquidity = options.initialLiquidity ?? DEFAULT_LIQUIDITY;
  const latestTick = options.initialTick;
  const id = options.id ?? 'stub';

  const buildStateAt = (tick: number): TPoolState => ({
    pool: options.pool,
    token0: {
      address: options.token0.address,
      symbol: options.token0.symbol,
      decimals: options.token0.decimals,
    },
    token1: {
      address: options.token1.address,
      symbol: options.token1.symbol,
      decimals: options.token1.decimals,
    },
    fee: options.fee,
    tickSpacing: options.tickSpacing,
    sqrtPriceX96: sqrtRatioAtTick(tick),
    tick,
    liquidity,
    feeGrowthGlobal0X128: 0n,
    feeGrowthGlobal1X128: 0n,
  });

  const head = options.latestBlock;

  const stub: IProtocolAdapter = {
    id,
    name: options.name ?? `Stub Adapter (${id})`,
    version: options.version ?? '0.0.0-stub',

    async discoverPools() {
      throw new Error('StubProtocolAdapter: discoverPools is not implemented');
    },

    async getPoolState(_pool: TAddress): Promise<TPoolState> {
      return buildStateAt(latestTick);
    },

    async getPoolStateAtBlock(
      _pool: TAddress,
      blockNumber: bigint,
    ): Promise<TPoolState> {
      // `blocksAgo` is how many steps back from the head this
      // block is. A negative value (i.e. block in the future)
      // would mean the caller is reading past the head, which
      // shouldn't happen in the history use case but we
      // tolerate it for safety.
      const blocksAgo = Number(head - blockNumber);
      const tick = latestTick - blocksAgo * tickDeltaPerBlock;
      return buildStateAt(tick);
    },

    async getTicks(_pool: TAddress, _range: TTickRange) {
      throw new Error('StubProtocolAdapter: getTicks is not implemented');
    },

    async quotePosition(
      _pool: TAddress,
      _range: TTickRange,
      _token0Amount: bigint,
    ) {
      throw new Error('StubProtocolAdapter: quotePosition is not implemented');
    },
  };

  return stub;
}
