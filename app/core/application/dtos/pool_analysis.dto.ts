// app/core/application/dtos/pool_analysis.dto.ts

import type { TAddress } from '../../shared/types';

/**
 * Output of {@link AnalyzePoolUseCase}. A protocol-neutral, UI-ready
 * summary of a single pool at the moment of analysis.
 *
 * All bigint fields use the standard Core scales (1e18 == 1.0):
 *   - `currentPrice`               — token1 per token0 at `priceDecimals`.
 *   - `currentPriceDecimals`       — decimals scale of `currentPrice`.
 *   - `annualizedVolatility`       — realized σ over the history window
 *                                    (0 when no history was supplied).
 *   - `cumulativeReturn`           — `latestPrice / earliestPrice` at
 *                                    `returnDecimals` (1e18 == 1.0 ==
 *                                    "no change"). Sign of the move.
 *   - `snapshotCount`              — number of historical snapshots
 *                                    underlying the analytics (0 if
 *                                    none).
 *   - `historyWindowSeconds`       — duration of the history window
 *                                    in seconds.
 *
 * `token0` / `token1` mirror the pool's on-chain metadata.
 */
export interface IPoolAnalysisDTO {
  readonly pool: TAddress;

  readonly chainId: number;

  readonly protocolId: string;

  readonly description: string;

  readonly feeTier: number;

  readonly tickSpacing: number;

  readonly currentTick: number;

  readonly currentPrice: bigint;

  readonly currentPriceDecimals: number;

  readonly token0: ITokenSummaryDTO;

  readonly token1: ITokenSummaryDTO;

  readonly annualizedVolatility: bigint;

  readonly cumulativeReturn: bigint;

  readonly returnDecimals: number;

  readonly snapshotCount: number;

  readonly historyWindowSeconds: bigint;
}

/**
 * Minimal token summary the UI needs to render a pool card. Symbols
 * are best-effort; addresses are the canonical key.
 */
export interface ITokenSummaryDTO {
  readonly address: TAddress;

  readonly symbol: string;

  readonly decimals: number;
}
