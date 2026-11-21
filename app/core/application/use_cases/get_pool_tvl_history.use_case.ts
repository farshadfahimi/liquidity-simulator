// app/core/application/use_cases/get_pool_tvl_history.use_case.ts

import type { TAddress, TPoolTvlPoint } from '../../shared/types';
import type { TPoolState } from '../../adapters/types';
import type { IProtocolAdapter } from '../../adapters/protocol_adapter.interface';
import type { IMarketDataProvider } from '../../providers/market';
import { InvalidUseCaseInputError } from '../errors/invalid_input_error';
import type { IPoolTvlHistoryDTO } from '../dtos/pool_tvl_history.dto';
import type { TAdapterResolver } from './adapter_resolver.type';

/**
 * Input for {@link GetPoolTvlHistoryUseCase}.
 */
export interface IGetPoolTvlHistoryInput {
  /** The pool to report on. */
  readonly pool: TAddress;

  /** Chain the pool lives on. */
  readonly chainId: number;

  /** Optional protocol id — resolved through the adapter registry. */
  readonly protocolId?: string;
}

/** Wall-clock seconds — the default timestamp source. */
function defaultNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/**
 * Get-pool-TVL-history use case (TVL roadmap slice 5): the **TVL
 * trend** of one pool, used by the charts tab to draw the "liquidity
 * flight" line next to the price chart.
 *
 * The use case is a thin, non-throwing wrapper around
 * {@link IMarketDataProvider.getPoolTvlHistory} plus the
 * **external-pool-id discovery** the provider needs (TVL-ROADMAP.md
 * §5.3):
 *
 *   1. the pool state is read (token0 / token1 / fee tier);
 *   2. the *natural key* `(project, chain, token pair, fee tier)` is
 *      matched against the provider's index — the very same match the
 *      liquidity read performs, which is how the provider learns the
 *      pool's own id (a DefiLlama UUID);
 *   3. the history is fetched with that id.
 *
 * **Degradation.** The use case never throws for missing market
 * data: an untracked pool, an unreachable provider or a failed pool
 * read all yield an **empty** `points` array, and the UI hides the TVL
 * series (TVL-ROADMAP.md §8). Only a *programming* error — an invalid
 * input — throws.
 */
export class GetPoolTvlHistoryUseCase {
  readonly id = 'get-pool-tvl-history';

  constructor(
    private readonly resolveAdapter: TAdapterResolver,
    private readonly market: IMarketDataProvider,
    private readonly now: () => bigint = defaultNow,
  ) {}

  async execute(input: IGetPoolTvlHistoryInput): Promise<IPoolTvlHistoryDTO> {
    if (!input.pool) {
      throw new InvalidUseCaseInputError(this.id, 'pool', 'address is required');
    }

    if (
      input.chainId === undefined
      || input.chainId === null
      || !Number.isInteger(input.chainId)
      || input.chainId <= 0
    ) {
      throw new InvalidUseCaseInputError(this.id, 'chainId', 'must be a positive integer');
    }

    const adapter = this.resolveAdapter(input.chainId, input.protocolId);

    // The pool state gives us the natural key (tokens + fee tier) the
    // provider matches on. A failed read is "data unavailable" —
    // the TVL series is simply not drawn.
    const state = await this.readPoolState(adapter, input.pool);

    if (!state) {
      return this.emptyDto(input, adapter.id);
    }

    const externalPoolId = await this.discoverExternalPoolId(
      input.chainId,
      adapter.id,
      state,
    );

    const points = await this.readHistory(input.chainId, state.pool);

    return {
      pool: input.pool,
      chainId: input.chainId,
      protocolId: adapter.id,
      points: normalizeTvlPoints(points),
      ...(externalPoolId !== undefined ? { externalPoolId } : {}),
      timestamp: this.now(),
    };
  }

  /**
   * Read the pool state, degrading to `null` when the read fails.
   */
  private async readPoolState(
    adapter: IProtocolAdapter,
    pool: TAddress,
  ): Promise<TPoolState | null> {
    try {
      return await adapter.getPoolState(pool);
    }
    catch {
      return null;
    }
  }

  /**
   * Match the pool against the provider's index.
   *
   * The provider remembers the pool's own id (the UUID the history
   * endpoint needs) while matching, so this call is what makes the
   * subsequent history read possible. Its *result* is only used for
   * the id — the snapshot itself is the TVL card's business (slice 3),
   * not this use case's.
   */
  private async discoverExternalPoolId(
    chainId: number,
    protocolId: string,
    state: TPoolState,
  ): Promise<string | undefined> {
    try {
      const liquidity = await this.market.getPoolLiquidity(
        chainId,
        protocolId,
        state.pool,
        state.token0.address,
        state.token1.address,
        state.fee,
      );

      return liquidity?.externalPoolId;
    }
    catch {
      return undefined;
    }
  }

  /** Read the TVL history, degrading to an empty list. */
  private async readHistory(
    chainId: number,
    pool: TAddress,
  ): Promise<readonly TPoolTvlPoint[]> {
    try {
      const points = await this.market.getPoolTvlHistory(chainId, pool);

      return points ?? [];
    }
    catch {
      return [];
    }
  }

  /** The "nothing to show" answer — still a valid DTO. */
  private emptyDto(
    input: IGetPoolTvlHistoryInput,
    protocolId: string,
  ): IPoolTvlHistoryDTO {
    return {
      pool: input.pool,
      chainId: input.chainId,
      protocolId,
      points: [],
      timestamp: this.now(),
    };
  }
}

/**
 * Normalize the provider's history into the shape the chart needs:
 * ascending by time, one point per timestamp, no negative amounts.
 *
 * `lightweight-charts` throws on unsorted data, and a provider that
 * reports the same timestamp twice would render as a glitch — so the
 * ordering is guaranteed here, in the Core, not in the UI.
 *
 * On a duplicate timestamp the **last** reading wins (the provider
 * re-reports the same day with a fresher value).
 */
export function normalizeTvlPoints(
  points: readonly TPoolTvlPoint[],
): readonly TPoolTvlPoint[] {
  const byTimestamp = new Map<bigint, TPoolTvlPoint>();

  for (const point of points) {
    if (point.tvlUsd < 0n) {
      continue;
    }

    byTimestamp.set(point.timestamp, point);
  }

  return [...byTimestamp.values()].sort((a, b) => {
    if (a.timestamp < b.timestamp) return -1;
    if (a.timestamp > b.timestamp) return 1;
    return 0;
  });
}
