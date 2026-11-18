// app/core/test/math/range_math.test.ts

/**
 * Offline unit tests (no RPC) for the range-sizing math:
 *
 *   - capital efficiency (CE) — real CE, narrower ⇒ higher
 *   - price-band ratio        — the old, width-increasing quantity
 *   - CE factor               — log-normalised score input
 *   - edge IL                 — stress IL at the worse range edge
 *   - tick-space volatility   — σ from ticks, scale conversions
 */

import { describe, expect, it } from 'vitest';

import {
  CAPITAL_EFFICIENCY_SCALE,
  CE_FACTOR_CEILING,
  CE_FACTOR_SCALE,
  IL_SCALE,
  LN_TICK,
  MAX_TICK,
  MIN_TICK,
  blendedSigmaTicksPerSecond,
  capitalEfficiencyFactor,
  capitalEfficiencyRatio,
  dailySigmaTicksFromAnnualVol,
  dailySigmaTicksFromSigmaPerSecond,
  ilAtRangeEdges,
  priceBandRatio,
  tickVariancePerSecond,
  type ITickSample,
} from '@core/math';

const SCALE = Number(CAPITAL_EFFICIENCY_SCALE);

function ceX(lower: number, upper: number, tick?: number): number {
  return Number(capitalEfficiencyRatio(lower, upper, tick)) / SCALE;
}

describe('capitalEfficiencyRatio (real CE)', () => {
  it('matches the white-paper value 1/(1-(Pl/Pu)^¼) for a symmetric range', () => {
    // ±1000 ticks ⇒ Pl/Pu = e^(-2000·ln1.0001) ⇒ CE = 1/(1-e^-0.05) ≈ 20.51
    const expected = 1 / (1 - Math.exp(-(2000 * LN_TICK) / 4));
    expect(ceX(-1000, 1000, 0)).toBeCloseTo(expected, 3);
    expect(ceX(-1000, 1000, 0)).toBeGreaterThan(20);
    expect(ceX(-1000, 1000, 0)).toBeLessThan(21);
  });

  it('defaults to the mid-range tick when currentTick is omitted', () => {
    expect(ceX(-1000, 1000)).toBeCloseTo(ceX(-1000, 1000, 0), 6);
    // Asymmetric range: midpoint tick is used.
    expect(ceX(0, 4000)).toBeCloseTo(ceX(0, 4000, 2000), 6);
  });

  it('is ≈ 1× for a (near) full-range span', () => {
    const lower = Math.ceil(MIN_TICK / 60) * 60;
    const upper = Math.floor(MAX_TICK / 60) * 60;
    expect(ceX(lower, upper, 0)).toBeGreaterThanOrEqual(1);
    expect(ceX(lower, upper, 0)).toBeLessThan(1.000001);
  });

  it('strictly DEcreases as the range widens (the pre-fix code increased)', () => {
    const halfWidths = [100, 500, 2000, 10_000, 50_000, 200_000];
    const ces = halfWidths.map((h) => ceX(-h, h, 0));

    for (let i = 1; i < ces.length; i++) {
      expect(ces[i]!).toBeLessThan(ces[i - 1]!);
    }
    expect(ces.every((c) => c >= 1)).toBe(true);
  });

  it('clamps an out-of-range currentTick to the nearest edge (no throw)', () => {
    // At the edge P = Pl: CE = 2 / (1 - √(Pl/Pu)).
    const atEdge = 2 / (1 - Math.exp(-(2000 * LN_TICK) / 2));
    expect(ceX(-1000, 1000, -5000)).toBeCloseTo(atEdge, 3);
    expect(ceX(-1000, 1000, 5000)).toBeCloseTo(atEdge, 3);
  });

  it('rejects invalid ranges', () => {
    expect(() => capitalEfficiencyRatio(10, 10)).toThrow();
    expect(() => capitalEfficiencyRatio(20, 10)).toThrow();
    expect(() => capitalEfficiencyRatio(MIN_TICK - 1, 0)).toThrow();
    expect(() => capitalEfficiencyRatio(0, MAX_TICK + 1)).toThrow();
    expect(() => capitalEfficiencyRatio(-10, 10, 0.5)).toThrow();
  });
});

describe('priceBandRatio (what capitalEfficiencyRatio used to return)', () => {
  it('equals 1.0001^(upper-lower) and GROWS with width', () => {
    const r1 = Number(priceBandRatio(-1000, 1000)) / SCALE;
    const r2 = Number(priceBandRatio(-5000, 5000)) / SCALE;
    expect(r1).toBeCloseTo(Math.exp(2000 * LN_TICK), 3);
    expect(r2).toBeGreaterThan(r1);
  });
});

describe('capitalEfficiencyFactor (log-normalised)', () => {
  it('maps 1× → 0 and the ceiling → 1', () => {
    expect(capitalEfficiencyFactor(CAPITAL_EFFICIENCY_SCALE)).toBe(0n);
    expect(capitalEfficiencyFactor(CE_FACTOR_CEILING)).toBe(CE_FACTOR_SCALE);
    expect(capitalEfficiencyFactor(CE_FACTOR_CEILING * 10n)).toBe(CE_FACTOR_SCALE);
  });

  it('puts 10× at ≈ half of a 100× ceiling (log scale)', () => {
    const f = Number(capitalEfficiencyFactor(10n * CAPITAL_EFFICIENCY_SCALE)) / Number(CE_FACTOR_SCALE);
    expect(f).toBeGreaterThan(0.49);
    expect(f).toBeLessThan(0.51);
  });

  it('is monotonic in CE and separates ±5% / ±10% / ±20% / ±50%', () => {
    const half = (pct: number) => Math.round(Math.log(1 + pct) / LN_TICK);
    const factors = [0.5, 0.2, 0.1, 0.05].map((pct) =>
      capitalEfficiencyFactor(capitalEfficiencyRatio(-half(pct), half(pct), 0)),
    );

    for (let i = 1; i < factors.length; i++) {
      expect(factors[i]!).toBeGreaterThan(factors[i - 1]!);
    }
    // None of them saturates at 1.0 (the old 5× cap saturated almost all).
    expect(factors[factors.length - 1]!).toBeLessThan(CE_FACTOR_SCALE);
  });
});

describe('ilAtRangeEdges', () => {
  it('is ≤ 0 and equals the V2 IL for a 2× move at the edge', () => {
    // ln2 / ln1.0001 ≈ 6931 ticks ⇒ edge ratios 2× and 0.5× ⇒ IL = 2√2/3 − 1 ≈ −5.72%.
    const t = Math.round(Math.LN2 / LN_TICK);
    const il = Number(ilAtRangeEdges(-t, t, 0)) / Number(IL_SCALE);
    expect(il).toBeLessThanOrEqual(0);
    expect(il).toBeCloseTo((2 * Math.sqrt(2)) / 3 - 1, 3);
  });

  it('is more negative for wider ranges and ~0 for a tight one', () => {
    const tight = ilAtRangeEdges(-10, 10, 0);
    const mid = ilAtRangeEdges(-2000, 2000, 0);
    const wide = ilAtRangeEdges(-20_000, 20_000, 0);

    expect(tight).toBeLessThan(0n);
    expect(Number(tight) / Number(IL_SCALE)).toBeGreaterThan(-1e-5);
    expect(mid).toBeLessThan(tight);
    expect(wide).toBeLessThan(mid);
  });

  it('takes the worse of the two edges for an asymmetric position', () => {
    // Price near the lower edge: the upper edge is the far, worse one.
    const il = ilAtRangeEdges(-1000, 9000, -900);
    const upperOnly = ilAtRangeEdges(-900, 9000, -900);
    expect(il).toBe(upperOnly);
  });

  it('never goes below −100% even for absurdly wide ranges', () => {
    const il = ilAtRangeEdges(MIN_TICK, MAX_TICK, 0);
    expect(il).toBeGreaterThanOrEqual(-IL_SCALE);
    expect(il).toBeLessThan(0n);
  });
});

describe('tick-space volatility', () => {
  const HOUR = 3600n;

  /** Alternating ±50 ticks every hour ⇒ |Δtick| = 100 per hour. */
  function zigzag(hours: number, amp = 50, start = 1_000_000n): ITickSample[] {
    return Array.from({ length: hours + 1 }, (_, i) => ({
      timestamp: start + BigInt(i) * HOUR,
      tick: 198_000 + (i % 2 === 0 ? -amp : amp),
    }));
  }

  it('recovers a known σ: |Δtick|=100/h ⇒ σ_daily = 100·√24 ticks', () => {
    const samples = zigzag(24 * 20);
    const perSec = Math.sqrt(tickVariancePerSecond(samples));

    expect(perSec).toBeCloseTo(100 / Math.sqrt(3600), 6);
    expect(dailySigmaTicksFromSigmaPerSecond(perSec)).toBeCloseTo(100 * Math.sqrt(24), 4);
  });

  it('blends the 14/30/60-day windows; a constant process returns the same σ', () => {
    const samples = zigzag(24 * 70);
    const blended = blendedSigmaTicksPerSecond(samples);
    expect(blended).toBeCloseTo(100 / Math.sqrt(3600), 6);
  });

  it('scales linearly with the move size (2× amplitude ⇒ 2× σ)', () => {
    const a = blendedSigmaTicksPerSecond(zigzag(24 * 30, 50));
    const b = blendedSigmaTicksPerSecond(zigzag(24 * 30, 100));
    expect(b / a).toBeCloseTo(2, 6);
  });

  it('falls back to the windows that have data on a short history', () => {
    const samples = zigzag(24 * 5); // only 5 days: 30d/60d windows equal the 14d one
    expect(blendedSigmaTicksPerSecond(samples)).toBeCloseTo(100 / Math.sqrt(3600), 6);
  });

  it('handles uneven spacing (Σ Δtick² / Σ Δt)', () => {
    const samples: ITickSample[] = [
      { timestamp: 0n, tick: 0 },
      { timestamp: 100n, tick: 10 },
      { timestamp: 400n, tick: 10 }, // no move over 300 s
    ];
    expect(tickVariancePerSecond(samples)).toBeCloseTo(100 / 400, 10);
  });

  it('rejects degenerate input', () => {
    expect(() => tickVariancePerSecond([{ timestamp: 1n, tick: 1 }])).toThrow();
    expect(() => blendedSigmaTicksPerSecond(zigzag(1))).toThrow();
    expect(() =>
      tickVariancePerSecond([
        { timestamp: 10n, tick: 1 },
        { timestamp: 5n, tick: 2 },
      ]),
    ).toThrow();
  });

  it('converts an ANNUALIZED vol to daily ticks (50% ⇒ ≈ 262 ticks, not 5000)', () => {
    const ticks = dailySigmaTicksFromAnnualVol(5n * 10n ** 17n);
    // 0.5 · √(1/365.25) / ln(1.0001) ≈ 261.6
    expect(ticks).toBeGreaterThan(255);
    expect(ticks).toBeLessThan(268);

    // Doubling the annual vol doubles the daily ticks; passing the annual
    // number straight through would be ≈ 19× too large.
    const double = dailySigmaTicksFromAnnualVol(10n ** 18n);
    expect(double / ticks).toBeCloseTo(2, 9);
  });
});
