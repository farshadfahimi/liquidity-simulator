// app/core/application/use_cases/replay_historical_performance.use_case.ts

import {
  SECONDS_PER_YEAR,
} from '../../math';
import { Pool } from '../../domains/pool';
import { Position } from '../../domains/position';
import { HistoricalReplaySimulation } from '../../domains/simulation';
import type { PoolHistory } from '../../domains/history';
import { TickRange } from '../../shared/value_objects';
import type { Price } from '../../shared/value_objects';
import type { TAddress } from '../../shared/types';
import { InvalidUseCaseInputError } from '../errors/invalid_input_error';
import { MissingPoolHistoryError } from '../errors/missing_history_error';
import type { IHistoricalReplayDTO } from '../dtos/historical_replay.dto';

/**
 * Input for {@link ReplayHistoricalPerformanceUseCase}.
 *
 * `history` is **required** — replay without a snapshot history is
 * just a single point, which doesn't help. When omitted, the use
 * case throws {@link MissingPoolHistoryError}.
 *
 * `feeRatePerSecond` is computed from `targetApr` (at APR_SCALE)
 * when omitted, using the same `apr / SPY` convention as the
 * historical-replay simulation itself.
 */
export interface IReplayHistoricalPerformanceInput {
  readonly pool: TAddress;

  readonly chainId: number;

  readonly range: {
    readonly tickLower: number;
    readonly tickUpper: number;
  };

  readonly principalInNumeraire: bigint;

  readonly numeraireToken: 'token0' | 'token1';

  readonly history: PoolHistory | undefined;

  /** Override entry price (defaults to current pool price at 18 dec). */
  readonly entryPrice?: Price;

  /** Override fee rate (defaults to `targetApr / SPY` when 0). */
  readonly feeRatePerSecond?: bigint;

  /** Target APR (at APR_SCALE) used when no feeRatePerSecond is supplied. */
  readonly targetApr?: bigint;
}

/**
 * History-replay use case: build a quoted position over a snapshot
 * history, run the historical-replay simulation, return a
 * flattened DTO the UI can chart / display directly.
 *
 * This use case does NOT call any adapter — the position quote
 * amounts are passed in via `quote` (or left zero). When the
 * caller doesn't quote, the simulation still runs with
 * `liquidity = amount0 = amount1 = 0n`, which is sufficient for
 * APR / IL / time-in-range metrics (those don't depend on
 * amounts).
 */
export class ReplayHistoricalPerformanceUseCase {
  readonly id = 'replay-historical-performance';

  constructor() {}

  async execute(
    input: IReplayHistoricalPerformanceInput,
  ): Promise<IHistoricalReplayDTO> {
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

    if (!input.history || input.history.size() < 2) {
      throw new MissingPoolHistoryError(this.id, input.pool, input.chainId);
    }

    if (input.principalInNumeraire < 0n) {
      throw new InvalidUseCaseInputError(
        this.id,
        'principalInNumeraire',
        'must be non-negative',
      );
    }

    // --- build a stub position ------------------------------------------
    // The historical-replay simulation only consumes `position.range`;
    // it doesn't touch amounts. We construct a Position with zero
    // amounts to keep the simulation pure. Real callers can pre-quote
    // and pass amounts via a future extension if needed.
    const stub = new Position(
      input.pool,
      new TickRange(input.range.tickLower, input.range.tickUpper),
      0n,
      0n,
      0n,
      '' as never,
      '' as never,
    );

    // We need a Pool object for the sim's `run(input, pool, position)`
    // signature, but the historical-replay simulation only reads
    // `pool.state.tick` to compute the in-range check per snapshot.
    // Build a minimal PoolState-shaped object to avoid a full
    // adapter round-trip (this use case is intentionally offline).
    const firstSnapshot = input.history.earliest()!;
    const poolStub = new Pool(
      {
        pool: input.pool,
        token0: {
          address: '' as never,
          symbol: '',
          name: '',
          decimals: 18,
        },
        token1: {
          address: '' as never,
          symbol: '',
          name: '',
          decimals: 18,
        },
        fee: 0,
        tickSpacing: 60,
        sqrtPriceX96: 0n,
        tick: firstSnapshot.tick,
        liquidity: firstSnapshot.liquidity,
        feeGrowthGlobal0X128: 0n,
        feeGrowthGlobal1X128: 0n,
      },
      input.chainId,
    );

    // --- fee rate derivation --------------------------------------------
    let feeRatePerSecond = input.feeRatePerSecond ?? 0n;

    if (feeRatePerSecond === 0n && input.targetApr && input.targetApr > 0n) {
      feeRatePerSecond = input.targetApr / SECONDS_PER_YEAR;
    }

    // --- entry price ----------------------------------------------------
    const entryPrice = input.entryPrice
      ?? input.history.earliest()!.price;

    // --- run simulation -------------------------------------------------
    const sim = new HistoricalReplaySimulation({ history: input.history });
    const out = sim.run(
      {
        entryPrice,
        feeRatePerSecond,
        principalInNumeraire: input.principalInNumeraire,
        numeraireToken: input.numeraireToken,
      },
      poolStub,
      stub,
    );

    // --- assemble DTO ---------------------------------------------------
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
      feeRatePerSecond,
      snapshotCount: input.history.size(),
      historyWindowSeconds: out.totalSeconds,
      totalFeesInNumeraire: out.totalFeesInNumeraire,
      apr: out.apr,
      meanIl: out.meanIl,
      minIl: out.minIl,
      maxIl: out.maxIl,
      finalIl: out.finalIl,
      timeInRangeFraction: out.timeInRangeFraction,
      maxDrawdown: out.maxDrawdown,
      nIntervals: out.nIntervals,
    };
  }
}
