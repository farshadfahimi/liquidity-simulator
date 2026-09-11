// app/core/domains/simulation/monte_carlo_simulation.class.ts

import {
  APR_SCALE,
  CAPITAL_EFFICIENCY_SCALE,
  IL_SCALE,
  SECONDS_PER_YEAR,
  bigintExp,
  bigintSqrtFloor,
  ilBetweenPrices,
} from '../../math';
import { Price } from '../../shared/value_objects';
import type { Pool } from '../pool';
import type { Position } from '../position';
import type { ISimulation } from './simulation.interface';

/**
 * Input for {@link MonteCarloSimulation}.
 *
 * Each MC path is a Geometric Brownian Motion:
 *
 *   p(t + dt) = p(t) * exp((μ − σ²/2) dt + σ √dt · Z)
 *
 * where `Z` is a standard normal. The drift `μ` and volatility `σ`
 * are *annual* fractions. Time stepping uses `numSteps` evenly
 * spaced intervals of `stepSeconds` each.
 *
 *   - `numPaths` — number of independent MC trials.
 *   - `numSteps` — discretization per path.
 *   - `seed` — 64-bit integer used to seed the LCG PRNG
 *     (deterministic given the same seed).
 *   - `muAnnual` — expected log-return drift, in 1e18-scaled units.
 *     For risk-neutral price-process modeling this is 0; for a
 *     bullish scenario use a positive value.
 *   - `sigmaAnnual` — annualized volatility, in 1e18-scaled units
 *     (matching `VOLATILITY_SCALE`).
 *   - `entryPrice` — initial price.
 *   - `feeRatePerSecond` — fees per second while in-range, expressed
 *     as a *fraction* of `principalInNumeraire` at 1e18 precision.
 *     Same convention as {@link IHistoricalReplaySimulationInput}:
 *     caller pre-computes
 *     `feeRatePerSecond = apr_fraction_1e18 / SECONDS_PER_YEAR`.
 *   - `principalInNumeraire` — initial notional.
 *
 * Output is per-path (`paths`) plus aggregates (`summary`).
 */
export interface IMonteCarloSimulationInput {
  /** Annual drift `μ` at 1e18 precision (1e18 == 100%/year). */
  readonly muAnnual: bigint;

  /** Annual volatility `σ` at 1e18 precision. */
  readonly sigmaAnnual: bigint;

  /** Number of independent MC paths. */
  readonly numPaths: number;

  /** Number of time steps per path. */
  readonly numSteps: number;

  /** Step duration in seconds. */
  readonly stepSeconds: bigint;

  /** PRNG seed (deterministic — same seed ⇒ same paths). */
  readonly seed: bigint;

  /** Initial price. */
  readonly entryPrice: Price;

  /** Fees per unit of principal per second, raw, at the principal's decimals. */
  readonly feeRatePerSecond: bigint;

  /** Principal in numeraire raw units. */
  readonly principalInNumeraire: bigint;

  /** Which token the principal + fees are denominated in. */
  readonly numeraireToken: 'token0' | 'token1';
}

/**
 * One row of a single MC path's per-step trajectory.
 */
export interface IMonteCarloSample {
  /** Step index (0 = entry). */
  readonly step: number;

  /** Path price at the end of this step, at `priceDecimals`. */
  readonly price: bigint;

  /** Decimal scale of `price` (matches the input `entryPrice.decimals`). */
  readonly priceDecimals: number;

  /** Side relative to the position at this step. */
  readonly side: 'below' | 'inside' | 'above';

  /** Cumulative fees accrued from step 0 → step, raw numeraire. */
  readonly cumulativeFees: bigint;
}

/**
 * One MC path's summary.
 */
export interface IMonteCarloPathResult {
  /** Path index (0..numPaths-1). */
  readonly pathIndex: number;

  /** Final price at step `numSteps`. */
  readonly finalPrice: bigint;
  readonly finalPriceDecimals: number;

  /** Final IL at the terminal price vs entry, at IL_SCALE. */
  readonly finalIl: bigint;

  /** Final side. */
  readonly finalSide: 'below' | 'inside' | 'above';

  /** Total fees accrued over the path, raw numeraire. */
  readonly totalFees: bigint;

  /** Terminal value (principal + fees), raw numeraire. */
  readonly terminalValueInNumeraire: bigint;

  /** Fraction of steps in-range, in [0, 1] at 1e18 precision. */
  readonly timeInRangeFraction: bigint;

  /** Per-step trajectory. */
  readonly samples: readonly IMonteCarloSample[];
}

/**
 * Aggregated statistics across `numPaths` paths.
 *
 *   - `meanFinalIl`, `p5FinalIl`, `p50FinalIl`, `p95FinalIl` — IL
 *     distribution at the terminal step, at IL_SCALE.
 *   - `meanApr`, `p5Apr`, `p50Apr`, `p95Apr` — APR distribution at
 *     APR_SCALE (1e18 == 100%).
 *   - `meanTimeInRange` — average across paths, in 1e18-precision
 *     fraction.
 *   - `probInRange` — fraction of paths whose terminal step is
 *     still in-range, in [0, 1] at 1e18 precision.
 *   - `meanTerminalValue`, `p5TerminalValue`, ...
 */
export interface IMonteCarloSummary {
  readonly numPaths: number;
  readonly numSteps: number;

  readonly meanFinalIl: bigint;
  readonly p5FinalIl: bigint;
  readonly p50FinalIl: bigint;
  readonly p95FinalIl: bigint;
  readonly minFinalIl: bigint;
  readonly maxFinalIl: bigint;

  readonly meanApr: bigint;
  readonly p5Apr: bigint;
  readonly p50Apr: bigint;
  readonly p95Apr: bigint;
  readonly minApr: bigint;
  readonly maxApr: bigint;

  readonly meanTimeInRange: bigint;
  readonly probInRange: bigint;

  readonly meanTerminalValue: bigint;
  readonly p5TerminalValue: bigint;
  readonly p50TerminalValue: bigint;
  readonly p95TerminalValue: bigint;
  readonly minTerminalValue: bigint;
  readonly maxTerminalValue: bigint;
}

/** Output of {@link MonteCarloSimulation}. */
export interface IMonteCarloSimulationOutput {
  readonly summary: IMonteCarloSummary;
  readonly paths: readonly IMonteCarloPathResult[];
}

/**
 * Linear congruential generator (64-bit). Same constants as the
 * Phase 4 smoke so seeds behave consistently across the codebase.
 *
 *   state' = (state * a + c) mod 2^64
 *
 * Returns the *new* state as a bigint.
 */
function lcgStep(state: bigint): bigint {
  const A = 6364136223846793005n;
  const C = 1442695040888963407n;
  const MOD = 1n << 64n;
  return (state * A + C) % MOD;
}

/**
 * Map a 64-bit LCG state to a standard-normal-ish deviate using
 * the Box-Muller transform. To keep the implementation simple and
 * avoid trigonometric heavy lifting on bigints, we use the
 * *central limit theorem* approximation: average 12 uniforms,
 * subtract 6, and treat the result as `~ N(0, 1)`.
 *
 * Accuracy: ≈ 1% tail error beyond ±3σ, plenty for MC estimation
 * at 1e18 precision.
 */
function lcgToStandardNormal(state: bigint): { z: number; state: bigint } {
  // 12 uniforms in [0, 1) via the top 53 bits of the LCG.
  let s = state;
  let sum = 0;

  for (let i = 0; i < 12; i++) {
    s = lcgStep(s);
    // Top 24 bits → [0, 1).
    sum += Number(s >> 40n) / (1 << 24);
  }

  return { z: sum - 6, state: s };
}

/**
 * Level-4 simulation: Monte Carlo over a Geometric Brownian Motion
 * price process. For each path:
 *
 *   1. Walk `numSteps` time-steps of `stepSeconds` each, generating
 *      a price path via GBM with the supplied `muAnnual` /
 *      `sigmaAnnual`.
 *   2. At each step, classify the position as
 *      in/below/above-range and accrue fees if in-range.
 *   3. Compute per-path summary + per-step samples.
 *
 * Aggregates summarize the distribution across all paths:
 *
 *   - mean / p5 / p50 / p95 of final IL and APR,
 *   - mean time-in-range and probability of ending in-range,
 *   - mean / p5 / p50 / p95 of terminal value.
 *
 * Deterministic given the same seed, so the smoke test can assert
 * on quantiles.
 *
 * Numerical notes:
 *
 *   - All log-return math is at 1e18 precision. `bigintExp` from
 *     `app/core/math/lnexp.util.ts` is used for `exp(x)` at 1e18.
 *   - Time scaling: `dtYears = stepSeconds / SECONDS_PER_YEAR` at
 *     1e18 precision.
 *   - `√dtYears` is computed via `bigintSqrtFloor` (private to
 *     `il.util`); we re-implement the sqrt locally using the
 *     Newton iteration exposed there.
 */
export class MonteCarloSimulation
  implements ISimulation<IMonteCarloSimulationInput, IMonteCarloSimulationOutput>
{
  readonly id = 'monte-carlo';

  static readonly IL_SCALE = IL_SCALE;

  static readonly APR_SCALE = APR_SCALE;

  static readonly CAPITAL_EFFICIENCY_SCALE = CAPITAL_EFFICIENCY_SCALE;

  static readonly SECONDS_PER_YEAR = SECONDS_PER_YEAR;

  static readonly ONE = 10n ** 18n;

  /** Per-call validation; throws if any input is invalid. */
  private validateInput(input: IMonteCarloSimulationInput): void {
    if (input.numPaths <= 0 || !Number.isInteger(input.numPaths)) {
      throw new Error(`MonteCarloSimulation numPaths must be a positive integer, got ${input.numPaths}`);
    }

    if (input.numSteps <= 0 || !Number.isInteger(input.numSteps)) {
      throw new Error(`MonteCarloSimulation numSteps must be a positive integer, got ${input.numSteps}`);
    }

    if (input.stepSeconds <= 0n) {
      throw new Error(`MonteCarloSimulation stepSeconds must be > 0, got ${input.stepSeconds}`);
    }

    if (input.entryPrice.value <= 0n) {
      throw new Error(`MonteCarloSimulation entryPrice.value must be > 0, got ${input.entryPrice.value}`);
    }

    if (input.principalInNumeraire <= 0n) {
      throw new Error(`MonteCarloSimulation principalInNumeraire must be > 0, got ${input.principalInNumeraire}`);
    }

    if (input.feeRatePerSecond < 0n) {
      throw new Error(`MonteCarloSimulation feeRatePerSecond must be >= 0, got ${input.feeRatePerSecond}`);
    }

    if (input.sigmaAnnual < 0n) {
      throw new Error(`MonteCarloSimulation sigmaAnnual must be >= 0, got ${input.sigmaAnnual}`);
    }
  }

  run(
    input: IMonteCarloSimulationInput,
    pool: Pool,
    position: Position,
  ): IMonteCarloSimulationOutput {
    this.validateInput(input);

    // Pre-compute step constants.
    const stepSeconds = input.stepSeconds;
    const spy = MonteCarloSimulation.SECONDS_PER_YEAR;
    // dtYears at 1e18 precision: stepSeconds * 1e18 / spy.
    const dtYears = (stepSeconds * MonteCarloSimulation.ONE) / spy;

    // sqrt(dtYears) at sqrt(1e18) precision = 1e9 == 1.0.
    const sqrtDtYearsSqrtScale = bigintSqrtFloor(dtYears);
    const sqrtDtYearsLnScale = sqrtDtYearsSqrtScale * 1_000_000_000n; // sqrt(1e18) = 1e9

    // Drift per step at 1e18 precision:
    //   (μ − σ²/2) × dtYears
    const sigma2 = (input.sigmaAnnual * input.sigmaAnnual) / MonteCarloSimulation.ONE;
    const halfSigma2 = sigma2 / 2n;
    const driftPerStep = ((input.muAnnual - halfSigma2) * dtYears) / MonteCarloSimulation.ONE;

    // Diffusion per step at 1e18 precision:
    //   σ × √dtYears
    const diffusionPerStep = (input.sigmaAnnual * sqrtDtYearsLnScale) / MonteCarloSimulation.ONE;

    // Fees per step (raw numeraire units):
    //   fees_per_step = principal × feeRatePerSecond × stepSeconds / 1e18
    //
    // `feeRatePerSecond` is at 1e18 precision in "fraction of
    // principal per second" units (see
    // `IHistoricalReplaySimulationInput` for the contract).
    const feesPerStep = input.principalInNumeraire
      * input.feeRatePerSecond * stepSeconds
      / MonteCarloSimulation.ONE;

    const entryPriceDecimals = input.entryPrice.decimals;
    const entryPriceScaled18 = entryPriceDecimals >= 18
      ? input.entryPrice.value * 10n ** BigInt(entryPriceDecimals - 18)
      : input.entryPrice.value / 10n ** BigInt(18 - entryPriceDecimals);

    const paths: IMonteCarloPathResult[] = [];

    let prngState = input.seed;

    for (let pIdx = 0; pIdx < input.numPaths; pIdx++) {
      const pathSamples: IMonteCarloSample[] = [];

      let currentPriceScaled18 = entryPriceScaled18; // bigint at 1e18
      let cumulativeFees = 0n;
      let inRangeCount = 0n;
      let totalFees = 0n;

      // Step 0 sample = entry.
      {
        const side = this.sideAtPrice(currentPriceScaled18, pool, position);
        pathSamples.push({
          step: 0,
          price: this.scalePriceToDecimals(currentPriceScaled18, entryPriceDecimals),
          priceDecimals: entryPriceDecimals,
          side,
          cumulativeFees: 0n,
        });
      }

      for (let step = 1; step <= input.numSteps; step++) {
        // Box-Muller-ish standard normal.
        const { z, state } = lcgToStandardNormal(prngState);
        prngState = state;

        // Convert z (Number, ~N(0,1)) to bigint at 1e18 precision.
        const zScaled = BigInt(Math.round(z * 1e6)) * 10n ** 12n;

        // log return at 1e18 precision:
        //   logReturn = drift + diffusion × Z
        const logReturn = driftPerStep + (diffusionPerStep * zScaled) / MonteCarloSimulation.ONE;

        // price_new = price × exp(logReturn).
        const multiplier = bigintExp(logReturn, 18);
        currentPriceScaled18 = (currentPriceScaled18 * multiplier) / MonteCarloSimulation.ONE;

        const side = this.sideAtPrice(currentPriceScaled18, pool, position);
        const inRange = side === 'inside';

        if (inRange) {
          cumulativeFees += feesPerStep;
          totalFees += feesPerStep;
          inRangeCount += 1n;
        }

        pathSamples.push({
          step,
          price: this.scalePriceToDecimals(currentPriceScaled18, entryPriceDecimals),
          priceDecimals: entryPriceDecimals,
          side,
          cumulativeFees,
        });
      }

      // Final IL + terminal value.
      const finalPrice = new Price(
        this.scalePriceToDecimals(currentPriceScaled18, entryPriceDecimals),
        entryPriceDecimals,
      );

      const finalIl = ilBetweenPrices(
        finalPrice.value,
        finalPrice.decimals,
        input.entryPrice.value,
        input.entryPrice.decimals,
        18, // outDecimals; IL_SCALE = 1e18 is the *value* of the scale.
      );

      const finalSide = pathSamples.at(-1)!.side;
      const terminalValue = input.principalInNumeraire + totalFees;

      const timeInRangeFraction = inRangeCount > 0n
        ? (inRangeCount * MonteCarloSimulation.ONE) / BigInt(input.numSteps)
        : 0n;

      paths.push({
        pathIndex: pIdx,
        finalPrice: finalPrice.value,
        finalPriceDecimals: finalPrice.decimals,
        finalIl,
        finalSide,
        totalFees,
        terminalValueInNumeraire: terminalValue,
        timeInRangeFraction,
        samples: pathSamples,
      });
    }

    // Aggregate.
    const summary = this.summarize(paths, input);

    return { summary, paths };
  }

  /**
   * Convert a bigint price at 1e18 precision to the desired
   * `decimals` scale.
   */
  private scalePriceToDecimals(priceAt18: bigint, targetDecimals: number): bigint {
    if (targetDecimals === 18) {
      return priceAt18;
    }

    if (targetDecimals < 18) {
      return priceAt18 / 10n ** BigInt(18 - targetDecimals);
    }

    return priceAt18 * 10n ** BigInt(targetDecimals - 18);
  }

  /**
   * Classify a price (at 1e18 precision) relative to a position's
   * range. We convert price → tick via the inverse of tickToPrice:
   *
   *   tick = ln(price / 10^d) / ln(1.0001)
   *
   * For the `numeraireToken === 'token1'` case the price is in
   * "token1 per token0" form, which is what `tickToPrice` uses for
   * `token1PerToken0`; the conversion is identical.
   */
  private sideAtPrice(
    priceAt18: bigint,
    _pool: Pool,
    position: Position,
  ): 'below' | 'inside' | 'above' {
    // Convert to Number for tick math (tick counts are small).
    const ratio = Number(priceAt18) / 1e18;

    if (ratio <= 0) {
      return 'above';
    }

    const tick = Math.round(Math.log(ratio) / Math.log(1.0001));

    if (tick < position.range.tickLower) {
      return 'below';
    }

    if (tick > position.range.tickUpper) {
      return 'above';
    }

    return 'inside';
  }

  /**
   * Compute aggregate statistics across paths.
   */
  private summarize(
    paths: readonly IMonteCarloPathResult[],
    input: IMonteCarloSimulationInput,
  ): IMonteCarloSummary {
    const n = paths.length;

    // Sort a copy by finalIl.
    const ilSorted = [...paths].sort((a, b) => (a.finalIl < b.finalIl ? -1 : 1));
    const aprSorted = [...paths].sort((a, b) => (a.totalFees < b.totalFees ? -1 : 1));
    const tvSorted = [...paths].sort((a, b) => (a.terminalValueInNumeraire < b.terminalValueInNumeraire ? -1 : 1));

    const sumFinalIl = paths.reduce((acc, p) => acc + p.finalIl, 0n);
    const sumApr = paths.reduce((acc, p) => acc + this.aprFromPath(p, input), 0n);
    const sumTir = paths.reduce((acc, p) => acc + p.timeInRangeFraction, 0n);
    const sumTv = paths.reduce((acc, p) => acc + p.terminalValueInNumeraire, 0n);
    const sumInRange = paths.reduce((acc, p) => acc + (p.finalSide === 'inside' ? 1n : 0n), 0n);

    const nBig = BigInt(n);

    return {
      numPaths: n,
      numSteps: input.numSteps,

      meanFinalIl: sumFinalIl / nBig,
      p5FinalIl: ilSorted[Math.floor(n * 0.05)]!.finalIl,
      p50FinalIl: ilSorted[Math.floor(n * 0.5)]!.finalIl,
      p95FinalIl: ilSorted[Math.floor(n * 0.95)]!.finalIl,
      minFinalIl: ilSorted[0]!.finalIl,
      maxFinalIl: ilSorted[n - 1]!.finalIl,

      meanApr: sumApr / nBig,
      p5Apr: aprSorted[Math.floor(n * 0.05)]!.totalFees === 0n
        ? 0n
        : this.aprFromPath(aprSorted[Math.floor(n * 0.05)]!, input),
      p50Apr: aprSorted[Math.floor(n * 0.5)]!.totalFees === 0n
        ? 0n
        : this.aprFromPath(aprSorted[Math.floor(n * 0.5)]!, input),
      p95Apr: aprSorted[Math.floor(n * 0.95)]!.totalFees === 0n
        ? 0n
        : this.aprFromPath(aprSorted[Math.floor(n * 0.95)]!, input),
      minApr: aprSorted[0]!.totalFees === 0n
        ? 0n
        : this.aprFromPath(aprSorted[0]!, input),
      maxApr: aprSorted[n - 1]!.totalFees === 0n
        ? 0n
        : this.aprFromPath(aprSorted[n - 1]!, input),

      meanTimeInRange: sumTir / nBig,
      probInRange: (sumInRange * MonteCarloSimulation.ONE) / nBig,

      meanTerminalValue: sumTv / nBig,
      p5TerminalValue: tvSorted[Math.floor(n * 0.05)]!.terminalValueInNumeraire,
      p50TerminalValue: tvSorted[Math.floor(n * 0.5)]!.terminalValueInNumeraire,
      p95TerminalValue: tvSorted[Math.floor(n * 0.95)]!.terminalValueInNumeraire,
      minTerminalValue: tvSorted[0]!.terminalValueInNumeraire,
      maxTerminalValue: tvSorted[n - 1]!.terminalValueInNumeraire,
    };
  }

  /**
   * Per-path APR at 1e18 precision (1e18 == 100% APR).
   *
   *   apr_1e18 = (totalFees × spy) / (principal × totalSeconds) × 1e18
   *
   * The `× 1e18` lifts the unitless ratio onto the same scale as
   * `APR_SCALE`. Same convention as
   * {@link HistoricalReplaySimulation}.
   */
  private aprFromPath(
    path: IMonteCarloPathResult,
    input: IMonteCarloSimulationInput,
  ): bigint {
    if (input.principalInNumeraire === 0n) {
      return 0n;
    }

    const totalSeconds = input.stepSeconds * BigInt(input.numSteps);

    if (totalSeconds === 0n) {
      return 0n;
    }

    const numerator = path.totalFees * MonteCarloSimulation.SECONDS_PER_YEAR * MonteCarloSimulation.ONE;
    const denominator = input.principalInNumeraire * totalSeconds;

    return numerator / denominator;
  }
}


