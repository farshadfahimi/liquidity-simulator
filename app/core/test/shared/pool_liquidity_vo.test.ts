// app/core/test/shared/pool_liquidity_vo.test.ts

/**
 * Slice 0 (TVL-ROADMAP.md §6) — the PoolLiquidity value object:
 *   - valid construction exposes every field
 *   - malformed snapshots throw at construction (never leak upward)
 *   - staleness policy (strictly-older-than, boundary exclusive)
 *
 * Pure — no network.
 */

import { describe, expect, it } from 'vitest';

import type { TAddress } from '@core/shared/types';
import { PoolLiquidityVO } from '@core/shared/value_objects';
import { USD_DECIMALS } from '@core/shared/utils';

/** $1.00 at `USD_DECIMALS` (6) — the bigint scale of every USD amount. */
const USD_SCALE = 10n ** BigInt(USD_DECIMALS);

const BASE = {
  pool: '0x0000000000000000000000000000000000000001' as TAddress,
  chainId: 8453,
  protocolId: 'uniswap-v3',
  tvlUsd: 88_992_532n * USD_SCALE,
  volume24hUsd: 87_887_325n * USD_SCALE,
  source: 'defi-llama' as const,
  timestamp: 1_795_000_000n,
};

describe('PoolLiquidityVO', () => {
  it('exposes all snapshot fields', () => {
    const vo = new PoolLiquidityVO({ ...BASE, externalPoolId: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' });

    expect(vo.pool).toBe(BASE.pool);
    expect(vo.chainId).toBe(BASE.chainId);
    expect(vo.protocolId).toBe(BASE.protocolId);
    expect(vo.tvlUsd).toBe(BASE.tvlUsd);
    expect(vo.volume24hUsd).toBe(BASE.volume24hUsd);
    expect(vo.externalPoolId).toBe('a1b2c3d4-e5f6-7890-abcd-ef0123456789');
    expect(vo.source).toBe('defi-llama');
    expect(vo.timestamp).toBe(BASE.timestamp);
  });

  it('allows unknown USD amounts (0n) and a missing external id', () => {
    const vo = new PoolLiquidityVO({ ...BASE, tvlUsd: 0n, volume24hUsd: 0n });

    expect(vo.tvlUsd).toBe(0n);
    expect(vo.volume24hUsd).toBe(0n);
    expect(vo.externalPoolId).toBeUndefined();
  });

  it('throws on negative USD amounts', () => {
    expect(() => new PoolLiquidityVO({ ...BASE, tvlUsd: -1n })).toThrow(/tvlUsd/);
    expect(() => new PoolLiquidityVO({ ...BASE, volume24hUsd: -1n })).toThrow(/volume24hUsd/);
  });

  it('throws on an unknown source', () => {
    expect(() => new PoolLiquidityVO({ ...BASE, source: 'made-up' as never })).toThrow(/source/);
  });

  it('throws on a bad pool address, chainId, protocol or timestamp', () => {
    expect(() => new PoolLiquidityVO({ ...BASE, pool: 'nope' as never })).toThrow(/pool/);
    expect(() => new PoolLiquidityVO({ ...BASE, chainId: 0 })).toThrow(/chainId/);
    expect(() => new PoolLiquidityVO({ ...BASE, chainId: 1.5 })).toThrow(/chainId/);
    expect(() => new PoolLiquidityVO({ ...BASE, protocolId: '' })).toThrow(/protocolId/);
    expect(() => new PoolLiquidityVO({ ...BASE, timestamp: 0n })).toThrow(/timestamp/);
  });

  it('throws on an empty externalPoolId', () => {
    expect(() => new PoolLiquidityVO({ ...BASE, externalPoolId: '' })).toThrow(/externalPoolId/);
  });

  it('isStale: strictly older than the window (boundary exclusive)', () => {
    const vo = new PoolLiquidityVO(BASE);

    expect(vo.isStale(3_600n, BASE.timestamp + 60n)).toBe(false); // fresh
    expect(vo.isStale(3_600n, BASE.timestamp + 3_600n)).toBe(false); // exactly at the limit
    expect(vo.isStale(3_600n, BASE.timestamp + 3_601n)).toBe(true); // one second past
  });

  it('isStale: defaults to the wall clock when no `now` is passed', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));

    const fresh = new PoolLiquidityVO({ ...BASE, timestamp: now - 60n });
    const stale = new PoolLiquidityVO({ ...BASE, timestamp: now - 7_200n });

    expect(fresh.isStale(3_600n)).toBe(false);
    expect(stale.isStale(3_600n)).toBe(true);
  });

  it('isStale throws on a negative window', () => {
    expect(() => new PoolLiquidityVO(BASE).isStale(-1n, 0n)).toThrow(/maxAgeSeconds/);
  });
});
