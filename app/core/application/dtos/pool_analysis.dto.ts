// app/core/application/dtos/pool_analysis.dto.ts

import type { TAddress, TPoolLiquiditySource } from '../../shared/types';

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
 *
 * **Liquidity block (optional).** When the caller supplies a
 * liquidity snapshot (`IAnalyzePoolInput.liquidity`), the DTO also
 * carries the market view of the pool:
 *
 *   - `tvlUsd`         — TVL, USD at `USD_DECIMALS` (6).
 *   - `volume24hUsd`   — rolling 24h volume, USD at `USD_DECIMALS`.
 *   - `feeApr`         — pool-level fee APR implied by the turnover,
 *                        at `APR_SCALE` (1e18 == 100%/yr). `0n` means
 *                        "no credible APR" (unknown turnover, or the
 *                        > 10,000%/yr outlier clamp fired) — render it
 *                        as "—", never as "0%".
 *   - `tvlSource`      — provenance of the numbers (the badge the UI
 *                        renders).
 *   - `tvlTimestamp`   — Unix seconds of the snapshot.
 *
 * Every one of these fields is **absent** (not `0n`) when no
 * liquidity snapshot was supplied, so the UI can tell "unknown" from
 * "zero".
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

  /** TVL in USD at `USD_DECIMALS` (6) — only with a liquidity snapshot. */
  readonly tvlUsd?: bigint;

  /** Rolling 24h volume in USD at `USD_DECIMALS` (6). */
  readonly volume24hUsd?: bigint;

  /** Implied fee APR at `APR_SCALE` (1e18 == 100%/yr). */
  readonly feeApr?: bigint;

  /** Provenance of the liquidity numbers. */
  readonly tvlSource?: TPoolLiquiditySource;

  /** Unix seconds of the liquidity snapshot. */
  readonly tvlTimestamp?: bigint;
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
