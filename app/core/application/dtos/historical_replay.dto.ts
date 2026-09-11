// app/core/application/dtos/historical_replay.dto.ts

import type { TAddress } from '../../shared/types';

/**
 * Output of {@link ReplayHistoricalPerformanceUseCase}. Wraps a
 * historical-replay simulation result with the input parameters so
 * the UI can render the replay context (e.g. "30-day replay of
 * USDC/WETH 0.05% at ±2% range, principal 100k USDC, fee rate
 * 0.30 APR").
 *
 * `metrics` mirrors {@link IHistoricalSimulationDTO} but is flattened
 * to top-level fields for easy consumption.
 */
export interface IHistoricalReplayDTO {
  readonly pool: TAddress;

  readonly chainId: number;

  readonly range: {
    readonly tickLower: number;
    readonly tickUpper: number;
  };

  readonly entryPrice: bigint;

  readonly entryPriceDecimals: number;

  readonly principalInNumeraire: bigint;

  readonly numeraireToken: 'token0' | 'token1';

  readonly feeRatePerSecond: bigint;

  readonly snapshotCount: number;

  readonly historyWindowSeconds: bigint;

  readonly totalFeesInNumeraire: bigint;

  readonly apr: bigint;

  readonly meanIl: bigint;

  readonly minIl: bigint;

  readonly maxIl: bigint;

  readonly finalIl: bigint;

  readonly timeInRangeFraction: bigint;

  readonly maxDrawdown: bigint;

  readonly nIntervals: number;
}
