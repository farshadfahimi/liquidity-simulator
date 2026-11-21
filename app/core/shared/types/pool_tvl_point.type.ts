// app/core/shared/types/pool_tvl_point.type.ts

/**
 * One point of a pool's TVL history.
 *
 * Money convention (TVL-ROADMAP §5.1): `tvlUsd` is a bigint at
 * `USD_DECIMALS` (6) — `1_000_000n` == `$1.00`.
 */
export interface TPoolTvlPoint {
  /** Unix seconds of the observation. */
  readonly timestamp: bigint;

  /** TVL at that point, USD, at `USD_DECIMALS` (6) scale. */
  readonly tvlUsd: bigint;
}
