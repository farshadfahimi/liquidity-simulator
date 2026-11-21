// app/core/application/dtos/pool_tvl.dto.ts

import type { TAddress, TPoolLiquidity, TPoolLiquiditySource } from '../../shared/types';

/**
 * Output of {@link GetPoolTvlUseCase} — the UI-ready liquidity
 * summary of a single pool.
 *
 * Scale conventions (all bigints, no floats cross the boundary):
 *   - `tvlUsd`, `volume24hUsd` — USD at `USD_DECIMALS` (6), so
 *     `1_000_000n` == `$1.00`.
 *   - `feeApr` — at `APR_SCALE` (1e18), so `1e18` == 100%/yr.
 *   - `amount0Raw`, `amount1Raw` — **raw** token units, scaled by
 *     each token's own `decimals`.
 *   - `positionShare` — at `SCORE_SCALE` (1e18), so `1e18` == 100%
 *     of the pool.
 *   - `timestamp` — Unix seconds.
 *
 * `source` is the single source of truth for "how good is this
 * number" and drives the badge the UI renders:
 *
 *   - `defi-llama` — an indexed market value. The best number we
 *     have, but only as fresh as the provider's index.
 *   - `on-chain-estimates` — computed locally from the pool's live
 *     state (virtual reserves). Always available, but it only counts
 *     the liquidity *active at the current tick*.
 *   - `token-units` — virtual reserves with no USD valuation at all
 *     (no prices, no stablecoin anchor). `tvlUsd` is `0n`; the two
 *     legs are still shown in token units.
 *
 * `feeApr` is `0n` both when the turnover is unknown *and* when the
 * implied APR was clamped as unreliable (> 10,000%/yr — see
 * TVL-ROADMAP.md §8). The UI must render `0n` as "—" / "n/a", never
 * as "0% APR".
 */
export interface IPoolTvlDTO {
  /** The pool address. */
  readonly pool: TAddress;

  /** Chain the pool lives on. */
  readonly chainId: number;

  /** Our protocol id (`uniswap-v3`, `shadow-cl`, …). */
  readonly protocolId: string;

  /** Total value locked, USD at `USD_DECIMALS` (6). `0n` = unknown. */
  readonly tvlUsd: bigint;

  /** Rolling 24h volume, USD at `USD_DECIMALS` (6). `0n` = unknown. */
  readonly volume24hUsd: bigint;

  /** Pool-level fee APR implied by the 24h turnover, at `APR_SCALE`. */
  readonly feeApr: bigint;

  /** Virtual-reserve leg 0 — raw units of `token0.decimals`. */
  readonly amount0Raw: bigint;

  /** Virtual-reserve leg 1 — raw units of `token1.decimals`. */
  readonly amount1Raw: bigint;

  /**
   * The deposit's share of the pool, at `SCORE_SCALE` (1e18 ==
   * 100%). `0n` when no notional was supplied or the TVL is unknown.
   */
  readonly positionShare: bigint;

  /** Provenance of the numbers — drives the UI badge. */
  readonly source: TPoolLiquiditySource;

  /** The provider's own pool id (DefiLlama UUID) when matched. */
  readonly externalPoolId?: string;

  /** Unix seconds of the snapshot. */
  readonly timestamp: bigint;
}

/**
 * Project a TVL DTO back onto the shared {@link TPoolLiquidity}
 * snapshot.
 *
 * The recommendation flow (TVL roadmap slice 4) needs the *snapshot*
 * (not the UI DTO) because the engine reads `tvlUsd` / `volume24hUsd`
 * to derive the pool's fee APR. The DTO already carries every field
 * the snapshot needs, so the projection is lossless.
 */
export function toPoolLiquidity(dto: IPoolTvlDTO): TPoolLiquidity {
  return {
    pool: dto.pool,
    chainId: dto.chainId,
    protocolId: dto.protocolId,
    tvlUsd: dto.tvlUsd,
    volume24hUsd: dto.volume24hUsd,
    source: dto.source,
    timestamp: dto.timestamp,
    ...(dto.externalPoolId !== undefined ? { externalPoolId: dto.externalPoolId } : {}),
  };
}
