// app/core/application/dtos/position_simulation.dto.ts

import type { TAddress } from '../../shared/types';

/**
 * Output of {@link SimulatePositionUseCase}. Combines a quoted
 * position with one or more simulation results at a single entry
 * price.
 *
 * `quote` is the protocol-neutral quote of the position as it would
 * be minted at the supplied `principalInNumeraire`. The same range is
 * then fed through the available simulation levels:
 *
 *   - `deposit`      — what the LP gets at entry (snapshot only).
 *   - `futurePrice`  — single Monte Carlo / GBM path summary
 *                      (worst-case terminal IL / value).
 *   - `historical`   — replay over a snapshot history. `null` when
 *                      the caller didn't supply history.
 *   - `monteCarlo`   — N-path Monte Carlo summary (mean / percentiles
 *                      of terminal value). `null` when not requested.
 *
 * All simulation outputs use the standard Core scales; see
 * `simulation.interface.ts` and the individual simulation class docs.
 */
export interface IPositionSimulationDTO {
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

  readonly quote: IQuoteSummaryDTO;

  readonly deposit: IDepositSimulationDTO;

  readonly futurePrice: IFuturePriceSimulationDTO | null;

  readonly historical: IHistoricalSimulationDTO | null;

  readonly monteCarlo: IMonteCarloSimulationDTO | null;
}

/**
 * Summary of the on-protocol position quote. `amount0` and `amount1`
 * are in raw token units (token0.decimals / token1.decimals).
 */
export interface IQuoteSummaryDTO {
  readonly liquidity: bigint;

  readonly amount0: bigint;

  readonly amount1: bigint;
}

/**
 * Output of {@link DepositSimulation}. At entry the position's
 * amounts are simply the quote — this DTO is here so the UI can
 * render the "what you'd put in" card without inspecting the
 * underlying domain object.
 */
export interface IDepositSimulationDTO {
  readonly amount0: bigint;

  readonly amount1: bigint;

  readonly notionalInNumeraire: bigint;
}

/**
 * Output of {@link FuturePriceSimulation}. Worst-case terminal value
 * for a single GBM path (or the requested worst-case percentile).
 * `terminalPrice` is in numeraire-per-token units at
 * `terminalPriceDecimals`.
 */
export interface IFuturePriceSimulationDTO {
  readonly terminalPrice: bigint;

  readonly terminalPriceDecimals: number;

  readonly terminalValueInNumeraire: bigint;

  readonly terminalIl: bigint;

  readonly horizonSeconds: bigint;
}

/**
 * Output of {@link HistoricalReplaySimulation} serialized for the UI.
 * Mirrors `IHistoricalReplaySimulationOutput` with the same scale
 * conventions. `apr` is at `APR_SCALE`; `il` fields at `IL_SCALE`;
 * `timeInRangeFraction` at 1e18 == 1.0.
 */
export interface IHistoricalSimulationDTO {
  readonly apr: bigint;

  readonly meanIl: bigint;

  readonly minIl: bigint;

  readonly maxIl: bigint;

  readonly finalIl: bigint;

  readonly timeInRangeFraction: bigint;

  readonly maxDrawdown: bigint;

  readonly totalFeesInNumeraire: bigint;

  readonly totalSeconds: bigint;

  readonly nIntervals: number;

  readonly nSnapshots: number;
}

/**
 * Output of {@link MonteCarloSimulation}. Percentiles are at 1e18
 * precision; `terminalValueMean` is the mean of all sampled terminal
 * values (at numeraire raw units, not scaled).
 */
export interface IMonteCarloSimulationDTO {
  readonly nPaths: number;

  readonly horizonSeconds: bigint;

  readonly terminalValueMean: bigint;

  readonly terminalValueP05: bigint;

  readonly terminalValueP50: bigint;

  readonly terminalValueP95: bigint;

  readonly terminalIlMean: bigint;

  readonly terminalIlP05: bigint;

  readonly terminalIlP50: bigint;

  readonly terminalIlP95: bigint;

  readonly timeInRangeFraction: bigint;
}
