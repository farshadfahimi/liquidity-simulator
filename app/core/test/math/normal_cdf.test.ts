// app/core/test/math/normal_cdf.test.ts

/**
 * `Φ(x)` — the standard normal CDF in fixed-point bigint
 * (TVL-ROADMAP.md §5.4: `P(in range) = 2Φ(k) − 1`).
 *
 * Network-free. The reference values are the well-known standard
 * normal percentiles (and `Φ(1)`), so the test pins the util
 * against numbers that are independent of the implementation.
 */

import { describe, expect, it } from 'vitest';

import {
  NORMAL_CDF_SCALE,
  normalCdf,
  twoSidedCoverage,
} from '@core/math';

/** 1e-15 in probability — 1000 units at the 1e18 output scale. */
const TOLERANCE = 1_000n;

function expectClose(actual: bigint, expected: bigint, tolerance: bigint = TOLERANCE): void {
  const diff = actual > expected ? actual - expected : expected - actual;
  expect(diff).toBeLessThanOrEqual(tolerance);
}

describe('normalCdf — Φ(x) at 1e18', () => {
  it('Φ(0) is exactly 0.5', () => {
    expect(normalCdf(0)).toBe(NORMAL_CDF_SCALE / 2n);
  });

  it('Φ(1) ≈ 0.8413447460685429', () => {
    expectClose(normalCdf(1), 841_344_746_068_542_948n);
  });

  it('matches the standard normal percentiles', () => {
    // 95th percentile: Φ(1.6448536269514722) = 0.95
    expectClose(normalCdf(1.6448536269514722), 950_000_000_000_000_000n);
    // 97.5th percentile: Φ(1.959963984540054) = 0.975
    expectClose(normalCdf(1.959963984540054), 975_000_000_000_000_000n);
    // 99th percentile: Φ(2.3263478740408408) = 0.99
    expectClose(normalCdf(2.3263478740408408), 990_000_000_000_000_000n);
  });

  it('is accurate in the far tail (asymptotic branch)', () => {
    // Beyond z = 4.5 (x ≈ 6.36) the power series would cancel
    // catastrophically, so the erfc tail branch takes over.
    expectClose(normalCdf(6.5), 999_999_999_959_840_139n);
    expectClose(normalCdf(7), 999_999_999_998_720_139n);
    expectClose(normalCdf(8), 999_999_999_999_999_299n);
  });

  it('is symmetric: Φ(−x) = 1 − Φ(x)', () => {
    for (const x of [0.5, 1, 1.65, 2, 2.5, 3.5, 6]) {
      expect(normalCdf(-x) + normalCdf(x)).toBe(NORMAL_CDF_SCALE);
    }
  });

  it('is monotonically increasing', () => {
    let previous = 0n;
    for (let x = -4; x <= 8; x += 0.25) {
      const current = normalCdf(x);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('saturates at the ends', () => {
    expect(normalCdf(12)).toBe(NORMAL_CDF_SCALE);
    expect(normalCdf(-12)).toBe(0n);
    expect(normalCdf(40)).toBe(NORMAL_CDF_SCALE);
    expect(normalCdf(-40)).toBe(0n);
  });

  it('rejects non-finite input', () => {
    expect(() => normalCdf(Number.NaN)).toThrow();
    expect(() => normalCdf(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('twoSidedCoverage — P(in range) = 2Φ(k) − 1', () => {
  it('is 0 at k = 0 and floored below it', () => {
    expect(twoSidedCoverage(0)).toBe(0n);
    expect(twoSidedCoverage(-1)).toBe(0n);
  });

  it('k = 1 → ≈ 68.3%', () => {
    expectClose(twoSidedCoverage(1), 682_689_492_137_085_897n);
  });

  it('k = 1.65 → ≈ 90.1%', () => {
    expectClose(twoSidedCoverage(1.65), 901_057_063_932_703_808n);
  });

  it('k = 2 → ≈ 95.4%', () => {
    expectClose(twoSidedCoverage(2), 954_499_736_103_641_585n);
  });

  it('k = 2.5 → ≈ 98.8%', () => {
    expectClose(twoSidedCoverage(2.5), 987_580_669_348_447_729n);
  });

  it('is monotonically increasing in k', () => {
    let previous = 0n;
    for (let k = 0; k <= 4; k += 0.25) {
      const current = twoSidedCoverage(k);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('rejects non-finite input', () => {
    expect(() => twoSidedCoverage(Number.NaN)).toThrow();
  });
});
