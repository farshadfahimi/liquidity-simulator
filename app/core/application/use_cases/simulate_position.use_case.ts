// app/core/application/use_cases/simulate_position.use_case.ts

import {
  SECONDS_PER_YEAR,
} from '../../math';
import { Position } from '../../domains/position';
import { Pool } from '../../domains/pool';
import { DepositSimulation } from '../../domains/simulation';
import { FuturePriceSimulation } from '../../domains/simulation';
import { HistoricalReplaySimulation } from '../../domains/simulation';
import { MonteCarloSimulation } from '../../domains/simulation';
import type { PoolHistory } from '../../domains/history';
import type { Price } from '../../shared/value_objects';
import type { TAddress } from '../../shared/types';
import { InvalidUseCaseInputError } from '../errors/invalid_input_error';
import type { IPositionSimulationDTO } from '../dtos/position_simulation.dto';
import type { IProtocolAdapter } from '../../adapters/protocol_adapter.interface';
import type { TAdapterResolver } from './adapter_resolver.type';

/**
 * Input for {@link SimulatePositionUseCase}.
 *
 * The use case quotes the position via `adapter.quotePosition(...)`
 * using `token0Amount` as the deposit cap, then runs the requested
 * simulation levels:
 *
 *   - **deposit** is always run.
 *   - **futurePrice** runs when `futurePrice` is supplied.
 *   - **historical** runs when `history` is supplied (and has ≥ 2
 *     snapshots). Uses a default `feeRatePerSecond = targetApr / SPY`
 *     if the caller doesn't supply one.
 *   - **monteCarlo** runs when `monteCarlo` is supplied (μ, σ, paths).
 *
 * `token0Amount` is the *intended* `token0` deposit (raw bigint,
 * `token0.decimals` precision). It's used both to drive
 * `adapter.quotePosition(...)` and to set `fillRatio` in the deposit
 * simulation. A zero amount means "only quote the range, don't
 * size it" — useful for the UI's "what if I deposit $X?" pre-flight.
 */
export interface ISimulatePositionInput {
  readonly pool: TAddress;

  readonly chainId: number;

  readonly protocolId?: string;

  readonly range: {
    readonly tickLower: number;
    readonly tickUpper: number;
  };

  readonly principalInNumeraire: bigint;

  readonly numeraireToken: 'token0' | 'token1';

  /** Optional override for the entry price (defaults to current). */
  readonly entryPrice?: Price;

  /** Deposit amount in `token0` raw units. Default `0n`. */
  readonly token0Amount?: bigint;

  /** Optional override for `feeRatePerSecond` used in the historical sim. */
  readonly feeRatePerSecond?: bigint;

  /** Target APR at `APR_SCALE` (1e18 == 100%). Used as the historical
   *  sim's feeRatePerSecond when no override is supplied. */
  readonly targetApr?: bigint;

  /** Future price scenario (drives the futurePrice simulation). */
  readonly futurePrice?: Price;

  /** Snapshot history for the historical replay simulation. */
  readonly history?: PoolHistory;

  /** Monte Carlo knobs. All fields required when supplied. */
  readonly monteCarlo?: {
    readonly muAnnual: bigint;
    readonly sigmaAnnual: bigint;
    readonly numPaths: number;
    readonly numSteps: number;
    readonly stepSeconds: bigint;
    readonly seed: bigint;
  };
}

/**
 * Position simulation use case: quotes a position and runs the
 * applicable simulation levels. Returns a single DTO that bundles
 * all results so the UI doesn't need to coordinate multiple use
 * cases.
 *
 * Implementation note: the deposit simulation is run *before* the
 * future-price / historical / Monte Carlo simulations because the
 * quote requires knowing the position amounts — those flows
 * re-quote internally. We avoid double-quoting by reusing the
 * quoted `Position` across all sims.
 */
export class SimulatePositionUseCase {
  readonly id = 'simulate-position';

  private readonly deposit: DepositSimulation = new DepositSimulation();

  private readonly futurePrice: FuturePriceSimulation = new FuturePriceSimulation();

  constructor(
    private readonly resolveAdapter: TAdapterResolver,
  ) {}

  async execute(input: ISimulatePositionInput): Promise<IPositionSimulationDTO> {
    // --- input validation ------------------------------------------------
    if (!input.pool) {
      throw new InvalidUseCaseInputError(this.id, 'pool', 'address is required');
    }

    if (input.range.tickLower >= input.range.tickUpper) {
      throw new InvalidUseCaseInputError(
        this.id,
        'range',
        `tickLower (${input.range.tickLower}) must be < tickUpper (${input.range.tickUpper})`,
      );
    }

    if (input.principalInNumeraire < 0n) {
      throw new InvalidUseCaseInputError(
        this.id,
        'principalInNumeraire',
        'must be non-negative',
      );
    }

    // --- fetch + quote ---------------------------------------------------
    const adapter = this.resolveAdapter(input.chainId, input.protocolId);
    const state = await adapter.getPoolState(input.pool);
    const pool = new Pool(state, input.chainId);

    const token0Amount = input.token0Amount ?? 0n;

    const quote = await adapter.quotePosition(
      input.pool,
      { tickLower: input.range.tickLower, tickUpper: input.range.tickUpper },
      token0Amount,
    );

    const position = Position.fromQuote(input.pool, quote);

    // --- entry price -----------------------------------------------------
    const entryPrice = input.entryPrice ?? pool.currentPrice(18);

    // --- deposit simulation (always) -------------------------------------
    const depositOut = this.deposit.run({ token0Amount }, pool, position);

    // Compute notional in numeraire. For token0-as-numeraire it's
    // `position.amount0` (already at token0.decimals); for
    // token1-as-numeraire it's `position.amount1`.
    const notionalInNumeraire = input.numeraireToken === 'token0'
      ? position.amount0
      : position.amount1;

    // --- future-price simulation (optional) ------------------------------
    let futurePriceDTO: IPositionSimulationDTO['futurePrice'] = null;

    if (input.futurePrice) {
      const fpOut = this.futurePrice.run(
        {
          entryPrice,
          futurePrice: input.futurePrice,
          numeraireToken: input.numeraireToken,
          principalInNumeraire: input.principalInNumeraire,
        },
        pool,
        position,
      );

      // The future-price scenario is a *single-shot* price move;
      // `FuturePriceSimulation` doesn't carry an explicit horizon
      // (the caller picks one with `futurePrice`). We use 1y as a
      // representative horizon so the DTO has a stable field; the
      // UI should treat `terminalValueInNumeraire` / `terminalIl`
      // as the canonical metrics for this simulation level.
      futurePriceDTO = {
        terminalPrice: input.futurePrice.value,
        terminalPriceDecimals: input.futurePrice.decimals,
        terminalValueInNumeraire: fpOut.terminalValueInNumeraire,
        terminalIl: fpOut.il,
        horizonSeconds: SECONDS_PER_YEAR,
      };
    }

    // --- historical replay simulation (optional) -------------------------
    let historicalDTO: IPositionSimulationDTO['historical'] = null;

    if (input.history && input.history.size() >= 2) {
      // feeRatePerSecond priority: explicit > targetApr-derived > 0.
      let feeRatePerSecond = input.feeRatePerSecond ?? 0n;

      if (feeRatePerSecond === 0n && input.targetApr && input.targetApr > 0n) {
        feeRatePerSecond = input.targetApr / SECONDS_PER_YEAR;
      }

      const histSim = new HistoricalReplaySimulation({ history: input.history });
      const histOut = histSim.run(
        {
          entryPrice,
          feeRatePerSecond,
          principalInNumeraire: input.principalInNumeraire,
          numeraireToken: input.numeraireToken,
        },
        pool,
        position,
      );

      historicalDTO = {
        apr: histOut.apr,
        meanIl: histOut.meanIl,
        minIl: histOut.minIl,
        maxIl: histOut.maxIl,
        finalIl: histOut.finalIl,
        timeInRangeFraction: histOut.timeInRangeFraction,
        maxDrawdown: histOut.maxDrawdown,
        totalFeesInNumeraire: histOut.totalFeesInNumeraire,
        totalSeconds: histOut.totalSeconds,
        nIntervals: histOut.nIntervals,
        nSnapshots: histOut.nSnapshots,
      };
    }

    // --- Monte Carlo simulation (optional) -------------------------------
    let monteCarloDTO: IPositionSimulationDTO['monteCarlo'] = null;

    if (input.monteCarlo && input.monteCarlo.numPaths > 0) {
      let feeRatePerSecond = input.feeRatePerSecond ?? 0n;

      if (feeRatePerSecond === 0n && input.targetApr && input.targetApr > 0n) {
        feeRatePerSecond = input.targetApr / SECONDS_PER_YEAR;
      }

      const mcSim = new MonteCarloSimulation();
      const mcOut = mcSim.run(
        {
          muAnnual: input.monteCarlo.muAnnual,
          sigmaAnnual: input.monteCarlo.sigmaAnnual,
          numPaths: input.monteCarlo.numPaths,
          numSteps: input.monteCarlo.numSteps,
          stepSeconds: input.monteCarlo.stepSeconds,
          seed: input.monteCarlo.seed,
          entryPrice,
          feeRatePerSecond,
          principalInNumeraire: input.principalInNumeraire,
          numeraireToken: input.numeraireToken,
        },
        pool,
        position,
      );

      const s = mcOut.summary;

      monteCarloDTO = {
        nPaths: s.numPaths,
        horizonSeconds: input.monteCarlo.stepSeconds * BigInt(input.monteCarlo.numSteps),
        terminalValueMean: s.meanTerminalValue,
        terminalValueP05: s.p5TerminalValue,
        terminalValueP50: s.p50TerminalValue,
        terminalValueP95: s.p95TerminalValue,
        terminalIlMean: s.meanFinalIl,
        terminalIlP05: s.p5FinalIl,
        terminalIlP50: s.p50FinalIl,
        terminalIlP95: s.p95FinalIl,
        timeInRangeFraction: s.meanTimeInRange,
      };
    }

    // --- assemble DTO ----------------------------------------------------
    return {
      pool: input.pool,
      chainId: input.chainId,
      range: {
        tickLower: input.range.tickLower,
        tickUpper: input.range.tickUpper,
      },
      entryPrice: entryPrice.value,
      entryPriceDecimals: entryPrice.decimals,
      principalInNumeraire: input.principalInNumeraire,
      numeraireToken: input.numeraireToken,
      quote: {
        liquidity: position.liquidity,
        amount0: position.amount0,
        amount1: position.amount1,
      },
      deposit: {
        amount0: depositOut.amount0,
        amount1: depositOut.amount1,
        notionalInNumeraire,
      },
      futurePrice: futurePriceDTO,
      historical: historicalDTO,
      monteCarlo: monteCarloDTO,
    };
  }
}

// (No scale re-exports — callers import from `@core/math` directly.)
