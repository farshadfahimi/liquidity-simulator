// app/core/shared/types/pool_liquidity.type.ts

import type { TAddress } from './address.type';

/**
 * Known sources of pool liquidity snapshots, best → weakest
 * (TVL-ROADMAP.md §8 fallback tiers). The DTO/UI renders `source` as
 * the single source-of-truth label for "how good is this number".
 *
 * - `defi-llama` — an indexed value from an external market-data
 *   provider. Accurate but only as fresh as the index.
 * - `on-chain-estimates` — computed locally from the pool state
 *   (virtual reserves). Always available, but only counts the
 *   liquidity *active at the current tick*.
 * - `token-units` — virtual reserves with no USD valuation at all
 *   (no token prices, no stablecoin anchor). The legs are still
 *   shown; `tvlUsd` is `0n`.
 */
export const POOL_LIQUIDITY_SOURCES = [
  'defi-llama',
  'on-chain-estimates',
  'token-units',
] as const;

/**
 * Where a liquidity/TVL snapshot came from. The UI renders this as a
 * badge — it is the single source of truth for "how good is this
 * number".
 */
export type TPoolLiquiditySource = (typeof POOL_LIQUIDITY_SOURCES)[number];

/**
 * A liquidity snapshot for one pool: how much value is locked in it
 * and how much traded through it.
 *
 * All money fields are bigint at `USD_DECIMALS` (6) — `1_000_000n`
 * == `$1.00`.
 */
export interface TPoolLiquidity {
  /** The pool address. */
  readonly pool: TAddress;

  /** Chain the pool lives on. */
  readonly chainId: number;

  /** Our protocol id (`uniswap-v3`, `shadow-cl`, …). */
  readonly protocolId: string;

  /** Total value locked, USD, at `USD_DECIMALS` (6) scale. */
  readonly tvlUsd: bigint;

  /** Rolling 24h volume, USD, at `USD_DECIMALS` (6) scale. `0n` = unknown. */
  readonly volume24hUsd: bigint;

  /**
   * The provider's own pool id (a UUID for DefiLlama) when matched —
   * needed to fetch the TVL history.
   */
  readonly externalPoolId?: string;

  /** Provenance of this snapshot — drives the display badge. */
  readonly source: TPoolLiquiditySource;

  /** Unix seconds of the snapshot. */
  readonly timestamp: bigint;
}
