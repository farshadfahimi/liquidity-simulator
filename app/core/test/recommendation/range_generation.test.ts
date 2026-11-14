// app/core/test/recommendation/range_generation.test.ts

/**
 * Offline tests (no RPC) for how candidate ranges are generated and
 * ranked:
 *
 *   - generators emit tickSpacing-aligned ranges inside the usable envelope
 *   - volatility-adjusted half-widths scale with σ and √horizon
 *   - CompareStrategiesUseCase sizes ranges from history σ (not fee tier)
 *   - narrow ranges are never out-ranked by wider ones on CE
 */

import { mainnet } from 'viem/chains';

import { describe, expect, it } from 'vitest';

import { CompareStrategiesUseCase } from '@core/application/use_cases/compare_strategies.use_case';
import type { IPoolHistoryDTO } from '@core/application/dtos/pool_history.dto';
import {
  ConstantRangeGenerator,
  HighestCapitalEfficiencyStrategy,
  LowestRiskStrategy,
  VolatilityAdjustedRangeGenerator,
} from '@core/domains/recommendation';
import { createPool } from '@core/domains';
import { MAX_TICK, MIN_TICK, sqrtRatioAtTick } from '@core/math';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
const POOL = '0x000000000000000000000000000000000000dEaD' as const;
const TICK = 198_000;

function makePool(tickSpacing: number, tick: number = TICK) {
  return createPool({
    chainId: mainnet.id,
    state: {
      pool: POOL,
      token0: { address: USDC, symbol: 'USDC', decimals: 6 },
      token1: { address: WETH, symbol: 'WETH', decimals: 18 },
      fee: tickSpacing === 10 ? 500 : tickSpacing === 60 ? 3000 : 10_000,
      tickSpacing,
      sqrtPriceX96: sqrtRatioAtTick(tick),
      tick,
      liquidity: 5_000_000_000_000_000_000n,
      feeGrowthGlobal0X128: 0n,
      feeGrowthGlobal1X128: 0n,
    },
  });
}

/** Hourly snapshots whose tick moves ±amp each step (known σ). */
function historyWith(
  amp: number,
  opts: { days?: number; source?: 'on-chain' | 'synthetic'; annualVol?: bigint } = {},
): IPoolHistoryDTO {
  const days = opts.days ?? 30;
  const n = days * 24 + 1;
  const start = 1_700_000_000n;
  const snapshots = Array.from({ length: n }, (_, i) => ({
    blockNumber: BigInt(21_000_000 + i * 300),
    timestamp: start + BigInt(i) * 3600n,
    tick: TICK + (i % 2 === 0 ? -amp : amp),
    price: 10n ** 18n,
    priceDecimals: 18,
  }));

  return {
    pool: POOL,
    chainId: mainnet.id,
    protocolId: 'uniswap-v3',
    source: opts.source ?? 'on-chain',
    sourceDetail: 'test',
    snapshots,
    candles: null,
    fromBlock: snapshots[0]!.blockNumber,
    toBlock: snapshots[n - 1]!.blockNumber,
    historyWindowSeconds: BigInt(n - 1) * 3600n,
    annualizedVolatility: opts.annualVol ?? 5n * 10n ** 17n,
  };
}

/** `-887220 % 60` is `-0` in JS, which `toBe(0)` rejects. */
function aligned(tick: number, spacing: number): boolean {
  return tick % spacing === 0;
}

function widths(ranges: readonly { tickLower: number; tickUpper: number }[]): number[] {
  return ranges.map((r) => r.tickUpper - r.tickLower);
}

describe('range generators: alignment and envelope', () => {
  for (const spacing of [10, 60, 200]) {
    it(`volatility-adjusted ranges are multiples of tickSpacing=${spacing}, lower < tick < upper`, () => {
      const pool = makePool(spacing);
      const gen = new VolatilityAdjustedRangeGenerator({
        dailySigmaTicks: 300,
        sigmaMultipliers: [0.5, 1, 1.65, 2, 2.5, 4],
      });
      const ranges = gen.generate(pool);

      expect(ranges.length).toBeGreaterThan(0);
      for (const r of ranges) {
        expect(aligned(r.tickLower, spacing)).toBe(true);
        expect(aligned(r.tickUpper, spacing)).toBe(true);
        expect(r.tickLower).toBeLessThan(TICK);
        expect(r.tickUpper).toBeGreaterThan(TICK);
      }
    });

    it(`clamps to a spacing-ALIGNED envelope for tickSpacing=${spacing} (not raw ±887272)`, () => {
      const pool = makePool(spacing);
      const huge = [
        new VolatilityAdjustedRangeGenerator({ dailySigmaTicks: 5_000_000, sigmaMultipliers: [1] }),
        new ConstantRangeGenerator({ widthsTicks: [10_000_000] }),
      ];

      for (const gen of huge) {
        const [r] = gen.generate(pool);
        expect(r).toBeDefined();
        expect(aligned(r!.tickLower, spacing)).toBe(true);
        expect(aligned(r!.tickUpper, spacing)).toBe(true);
        expect(r!.tickLower).toBeGreaterThanOrEqual(MIN_TICK);
        expect(r!.tickUpper).toBeLessThanOrEqual(MAX_TICK);
        expect(r!.tickLower).toBe(Math.ceil(MIN_TICK / spacing) * spacing);
        expect(r!.tickUpper).toBe(Math.floor(MAX_TICK / spacing) * spacing);
      }
    });
  }

  it('emits each distinct range once when several multipliers collapse together', () => {
    const pool = makePool(200);
    const gen = new VolatilityAdjustedRangeGenerator({
      dailySigmaTicks: 1,
      sigmaMultipliers: [1, 1.1, 1.2, 1.3],
    });
    const ranges = gen.generate(pool);
    const keys = ranges.map((r) => `${r.tickLower}:${r.tickUpper}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('accepts a real-valued σ (low-vol pools are not distorted by integer rounding)', () => {
    const pool = makePool(1);
    const a = new VolatilityAdjustedRangeGenerator({ dailySigmaTicks: 3.4, sigmaMultipliers: [10] });
    const [r] = a.generate(pool);
    // 10 × 3.4 = 34 ticks half-width (an integer-rounded σ=3 would give 30).
    expect(r!.tickUpper - r!.tickLower).toBe(68);
  });

  it('rejects non-positive / non-finite σ', () => {
    expect(() => new VolatilityAdjustedRangeGenerator({ dailySigmaTicks: 0, sigmaMultipliers: [1] })).toThrow();
    expect(() => new VolatilityAdjustedRangeGenerator({ dailySigmaTicks: Number.NaN, sigmaMultipliers: [1] })).toThrow();
  });
});

describe('volatility-adjusted width scaling', () => {
  it('doubles when σ doubles', () => {
    const pool = makePool(10);
    const w = (sigma: number) =>
      widths(new VolatilityAdjustedRangeGenerator({ dailySigmaTicks: sigma, sigmaMultipliers: [2] }).generate(pool))[0]!;

    // ±spacing alignment tolerance.
    expect(Math.abs(w(800) - 2 * w(400))).toBeLessThanOrEqual(20);
  });

  it('doubles when the horizon quadruples (σ_H = σ_day · √H)', () => {
    const pool = makePool(10);
    const w = (days: number) =>
      widths(
        new VolatilityAdjustedRangeGenerator({
          dailySigmaTicks: 300,
          sigmaMultipliers: [1.65 * Math.sqrt(days)],
        }).generate(pool),
      )[0]!;

    expect(Math.abs(w(28) - 2 * w(7))).toBeLessThanOrEqual(20);
  });
});

describe('CompareStrategiesUseCase range sizing', () => {
  const use = new CompareStrategiesUseCase();

  function topWidths(spacing: number, history: IPoolHistoryDTO | undefined, extra = {}) {
    const dto = use.execute({
      pool: makePool(spacing),
      protocolId: 'uniswap-v3',
      ...(history ? { history } : {}),
      ...extra,
    });
    const all = dto.recommendations.map((r) => r.tickUpper - r.tickLower);
    return { dto, all, min: Math.min(...all), max: Math.max(...all) };
  }

  it('sizes ranges from the pool history σ, independent of the fee tier', () => {
    // |Δtick| = 100/h ⇒ σ_day ≈ 490 ticks; k·√7 ⇒ half-width of a few thousand ticks.
    const history = historyWith(50);
    const a = topWidths(10, history);
    const b = topWidths(60, history);
    const c = topWidths(200, history);

    for (const x of [a, b, c]) {
      expect(x.all.length).toBeGreaterThan(0);
      // Nothing near the ±887k envelope, nothing silly-narrow.
      expect(x.max).toBeLessThan(60_000);
      expect(x.min).toBeGreaterThan(1_000);
    }

    // Different tickSpacing only changes the alignment, not the scale.
    expect(Math.abs(a.max - c.max)).toBeLessThanOrEqual(2 * 200 + 2 * 200);
  });

  it('uses the volatility-adjusted generator when history is on-chain', () => {
    const { dto } = topWidths(10, historyWith(50));
    expect(dto.rangeGeneratorId).toBe('volatility-adjusted-range');
  });

  it('a calmer pool gets proportionally narrower ranges', () => {
    const calm = topWidths(10, historyWith(10));
    const wild = topWidths(10, historyWith(100));
    expect(wild.max).toBeGreaterThan(calm.max * 5);
  });

  it('every generated range contains the current tick and is spacing-aligned', () => {
    const { dto } = topWidths(60, historyWith(50));
    for (const r of dto.recommendations) {
      expect(r.tickLower).toBeLessThan(TICK);
      expect(r.tickUpper).toBeGreaterThan(TICK);
      expect(aligned(r.tickLower, 60)).toBe(true);
      expect(aligned(r.tickUpper, 60)).toBe(true);
    }
  });

  it('ignores a SYNTHETIC history for σ and uses the annualized-vol prior instead', () => {
    // A synthetic series with absurd made-up moves must not widen the ranges.
    const synthetic = historyWith(5_000, { source: 'synthetic' });
    const withSynthetic = topWidths(10, synthetic);
    const noHistory = topWidths(10, undefined);
    expect(withSynthetic.max).toBe(noHistory.max);
    expect(withSynthetic.min).toBe(noHistory.min);
  });

  it('falls back to the 50% annualized prior when no history is given (≈ 262 ticks/day)', () => {
    const { max } = topWidths(10, undefined);
    // k=2.5, H=7 ⇒ half ≈ 2.5·√7·262 ≈ 1733 ticks ⇒ width ≈ 3466 (+ alignment).
    expect(max).toBeGreaterThan(3_000);
    expect(max).toBeLessThan(4_000);
  });

  it('keeps the explicit widthsTicks opt-in (ConstantRangeGenerator)', () => {
    const { all } = topWidths(10, historyWith(50), { widthsTicks: [100, 500] });
    expect(all.length).toBeGreaterThan(0);
    expect(Math.max(...all)).toBeLessThanOrEqual(2 * 500 * 10);
  });

  it('rejects invalid horizon / k values', () => {
    const pool = makePool(10);
    expect(() => use.execute({ pool, horizonDays: 0 })).toThrow();
    expect(() => use.execute({ pool, kValues: [] })).toThrow();
    expect(() => use.execute({ pool, kValues: [1, -2] })).toThrow();
  });
});

describe('strategy ordering with the real CE', () => {
  it('highest-capital-efficiency prefers the narrower range; lowest-risk the wider', () => {
    const pool = makePool(10);
    const gen = new VolatilityAdjustedRangeGenerator({
      dailySigmaTicks: 300,
      sigmaMultipliers: [1, 4],
    });
    const [tight, wide] = [...gen.generate(pool)].sort(
      (a, b) => a.tickUpper - a.tickLower - (b.tickUpper - b.tickLower),
    );

    const pos = (range: typeof tight) => ({ range }) as never;
    const hce = new HighestCapitalEfficiencyStrategy();
    const lr = new LowestRiskStrategy({ entryPrice: pool.currentPrice(18) });

    expect(hce.score(pool, pos(tight!))).toBeGreaterThan(hce.score(pool, pos(wide!)));
    expect(lr.score(pool, pos(wide!))).toBeGreaterThan(lr.score(pool, pos(tight!)));
  });
});
