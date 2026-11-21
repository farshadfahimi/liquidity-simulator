// app/core/shared/value_objects/pool_liquidity.value-object.ts

import { POOL_LIQUIDITY_SOURCES } from '../types';

import type { TAddress, TPoolLiquidity, TPoolLiquiditySource } from '../types';

/**
 * Immutable value object wrapping a market-level pool liquidity
 * snapshot (TVL-ROADMAP.md §5.1). Validates the snapshot at
 * construction so a malformed provider payload can never reach the
 * application layer: non-negative USD amounts, a known `source`, a
 * positive timestamp, a plausible pool address and a positive chain id.
 *
 * Acts as the canonical "what the market says about this pool's
 * liquidity" handle inside the domain layer — the TVL sibling of
 * {@link PoolStateVO}.
 */
export class PoolLiquidityVO {
  /** Pool contract address. */
  readonly pool: TAddress;

  /** EVM chain id the pool lives on. */
  readonly chainId: number;

  /** Adapter/protocol id, e.g. `'uniswap-v3'`. */
  readonly protocolId: string;

  /** Total value locked, USD at `USD_DECIMALS` (6). `0n` = unknown. */
  readonly tvlUsd: bigint;

  /** 24h volume, USD at `USD_DECIMALS` (6). `0n` = unknown. */
  readonly volume24hUsd: bigint;

  /** External pool id (DefiLlama UUID) when matched in the index. */
  readonly externalPoolId?: string;

  /** Where the numbers came from (see `POOL_LIQUIDITY_SOURCES`). */
  readonly source: TPoolLiquiditySource;

  /** Unix seconds of the snapshot. */
  readonly timestamp: bigint;

  constructor(data: TPoolLiquidity) {
    if (typeof data.pool !== 'string' || !data.pool.startsWith('0x') || data.pool.length <= 2) {
      throw new Error(
        `PoolLiquidityVO: pool must be a 0x address, got ${String(data.pool)}`,
      );
    }

    if (!Number.isInteger(data.chainId) || data.chainId <= 0) {
      throw new Error(
        `PoolLiquidityVO: chainId must be a positive integer, got ${data.chainId}`,
      );
    }

    if (typeof data.protocolId !== 'string' || data.protocolId.length === 0) {
      throw new Error(
        'PoolLiquidityVO: protocolId must be a non-empty string',
      );
    }

    if (data.tvlUsd < 0n) {
      throw new Error(
        `PoolLiquidityVO: tvlUsd must be non-negative, got ${data.tvlUsd}`,
      );
    }

    if (data.volume24hUsd < 0n) {
      throw new Error(
        `PoolLiquidityVO: volume24hUsd must be non-negative, got ${data.volume24hUsd}`,
      );
    }

    if (!POOL_LIQUIDITY_SOURCES.includes(data.source)) {
      throw new Error(
        `PoolLiquidityVO: unknown source "${String(data.source)}" `
        + `(known: ${POOL_LIQUIDITY_SOURCES.join(', ')})`,
      );
    }

    if (data.timestamp <= 0n) {
      throw new Error(
        `PoolLiquidityVO: timestamp must be positive, got ${data.timestamp}`,
      );
    }

    if (
      data.externalPoolId !== undefined
      && (typeof data.externalPoolId !== 'string' || data.externalPoolId.length === 0)
    ) {
      throw new Error(
        'PoolLiquidityVO: externalPoolId, when present, must be a non-empty string',
      );
    }

    this.pool = data.pool;
    this.chainId = data.chainId;
    this.protocolId = data.protocolId;
    this.tvlUsd = data.tvlUsd;
    this.volume24hUsd = data.volume24hUsd;
    this.externalPoolId = data.externalPoolId;
    this.source = data.source;
    this.timestamp = data.timestamp;
  }

  /**
   * Whether the snapshot is older than `maxAgeSeconds` (boundary is
   * exclusive: exactly `maxAgeSeconds` old is still fresh).
   *
   * @param maxAgeSeconds - Freshness window, Unix seconds.
   * @param now - Current time override, Unix seconds. Defaults to the
   *   wall clock; tests pass an explicit value for determinism.
   * @throws When `maxAgeSeconds` is negative.
   */
  isStale(
    maxAgeSeconds: bigint,
    now: bigint = BigInt(Math.floor(Date.now() / 1000)),
  ): boolean {
    if (maxAgeSeconds < 0n) {
      throw new Error(
        `PoolLiquidityVO.isStale: maxAgeSeconds must be non-negative, got ${maxAgeSeconds}`,
      );
    }

    return now - this.timestamp > maxAgeSeconds;
  }
}

