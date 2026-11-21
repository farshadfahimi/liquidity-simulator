// app/core/test/math/fee_apr.test.ts

/**
 * Slice 0 (TVL-ROADMAP.md §6) — fee-APR-from-turnover math:
 *   - hand-verified APRs for known volume/TVL/fee triples
 *   - degradation rules (zero volume → 0n; invalid inputs throw)
 *   - the annualization helper
 *
 * Pure bigint math — no network.
 *
 * Note: the roadmap's §6 example ("volume=10M, tvl=100M, fee=0.05% →
 * 18.25%/yr") contained an arithmetic slip: (0.1 × 0.0005 × 365) =
 * 1.825%, not 18.25%. The tests below assert the correct value; the
 * 18.25% case is included separately with volume equal to TVL.
 */

import { describe, expect, it } from 'vitest';

import { APR_SCALE, annualizeDailyRate, feeAprFromTurnover } from '@core/math';

const USD = 1_000_000n; // one USD at USD_DECIMALS (6)

describe('feeAprFromTurnover', () => {
  it('10M 24h volume over 100M TVL at 0.05% fee → 1.825% APR', () => {
    const apr = feeAprFromTurnover(
      10_000_000n * USD,
      100_000_000n * USD,
      0.0005,
    );
    // (10/100) × 0.0005 × 365 = 0.01825
    expect(apr).toBe(18_250_000_000_000_000n);
  });

  it('100M 24h volume over 100M TVL at 0.05% fee → 18.25% APR', () => {
    const apr = feeAprFromTurnover(
      100_000_000n * USD,
      100_000_000n * USD,
      0.0005,
    );
    // (100/100) × 0.0005 × 365 = 0.1825
    expect(apr).toBe(182_500_000_000_000_000n);
  });

  it('accepts feeRate as pool.fee / 1e6 (Shadow CL 0.24% tier = 2400)', () => {
    const apr = feeAprFromTurnover(
      50_000_000n * USD,
      10_000_000n * USD,
      2400 / 1_000_000,
    );
    // (50/10) × 0.0024 × 365 = 4.38 → 438%/yr
    expect(apr).toBe(4_380_000_000_000_000_000n);
  });

  it('unknown volume (0n) yields 0n — the caller keeps its prior', () => {
    expect(feeAprFromTurnover(0n, 100_000_000n * USD, 0.0005)).toBe(0n);
  });

  it('throws when TVL is zero or negative (caller must fall back first)', () => {
    expect(() => feeAprFromTurnover(1n, 0n, 0.0005)).toThrow(/tvlUsd/);
    expect(() => feeAprFromTurnover(1n, -1n, 0.0005)).toThrow(/tvlUsd/);
  });

  it('throws on negative volume', () => {
    expect(() => feeAprFromTurnover(-1n, 100_000_000n * USD, 0.0005)).toThrow(/volume24hUsd/);
  });

  it('throws on feeRate outside (0, 1) or non-finite', () => {
    const badRates = [0, -0.01, 1, 2.5, Number.NaN, Number.POSITIVE_INFINITY];

    for (const bad of badRates) {
      expect(() => feeAprFromTurnover(1n, 100n, bad)).toThrow(/feeRate/);
    }
  });
});

describe('annualizeDailyRate', () => {
  it('multiplies a daily rate by 365 by default', () => {
    const daily = 5n * 10n ** 14n; // 0.05%/day
    expect(annualizeDailyRate(daily)).toBe(daily * 365n);
  });

  it('honors a custom days-per-year', () => {
    expect(annualizeDailyRate(APR_SCALE, 100n)).toBe(100n * APR_SCALE);
  });

  it('accepts a zero daily rate', () => {
    expect(annualizeDailyRate(0n)).toBe(0n);
  });

  it('throws on negative rate or non-positive days', () => {
    expect(() => annualizeDailyRate(-1n)).toThrow(/dailyRate/);
    expect(() => annualizeDailyRate(1n, 0n)).toThrow(/daysPerYear/);
  });
});
