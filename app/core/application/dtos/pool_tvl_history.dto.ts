// app/core/application/dtos/pool_tvl_history.dto.ts

import type { TAddress, TPoolTvlPoint } from '../../shared/types';

/**
 * Output of {@link GetPoolTvlHistoryUseCase} — the TVL *trend* of a
 * single pool, ready for the charts tab.
 *
 * Scale conventions (same money convention as the rest of the Core,
 * TVL-ROADMAP.md §5.1):
 *   - `points[].tvlUsd` — USD at `USD_DECIMALS` (6), so `1_000_000n`
 *     == `$1.00`.
 *   - `points[].timestamp` — unix **seconds**.
 *
 * The points are **chronologically ascending** (oldest first) and
 * de-duplicated by timestamp — `lightweight-charts` refuses unsorted
 * data, so the ordering is guaranteed here rather than in the UI.
 *
 * An **empty** `points` array is a normal, non-error outcome: the
 * pool simply isn't tracked by the market-data provider (or the
 * provider is unreachable). The UI hides the TVL series in that case
 * (TVL-ROADMAP.md §8) — it never renders an empty chart.
 */
export interface IPoolTvlHistoryDTO {
  /** The pool address. */
  readonly pool: TAddress;

  /** Chain the pool lives on. */
  readonly chainId: number;

  /** Our protocol id (`uniswap-v3`, `shadow-cl`, …). */
  readonly protocolId: string;

  /**
   * The TVL history, oldest → newest. Empty when the pool isn't
   * tracked by the provider.
   */
  readonly points: readonly TPoolTvlPoint[];

  /**
   * The provider's own pool id (a DefiLlama UUID) when the pool was
   * matched — the id the history was fetched with.
   */
  readonly externalPoolId?: string;

  /** Unix seconds of the snapshot. */
  readonly timestamp: bigint;
}
