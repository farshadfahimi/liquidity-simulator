// app/core/application/dtos/pool_history.dto.ts

import type { TAddress } from '../../shared/types';
import type { IHistoryCandleMap } from './candle.dto';

/**
 * Output of {@link GetPoolHistoryUseCase}. A flat, chart-ready
 * representation of a pool's price history. The UI never has to
 * touch the domain `PoolHistory` / `PoolSnapshot` value objects
 * directly — the DTO only carries what a chart needs (one point
 * per snapshot, in chronological order).
 *
 * `source` distinguishes real on-chain history from the synthetic
 * GBM fallback the use case falls back to when the underlying RPC
 * doesn't expose archive state for the requested block range.
 *
 * `candles` is **opt-in**: when the caller asks the use case to
 * aggregate the snapshot stream into OHLC bars, the per-timeframe
 * candle arrays are populated. When the caller doesn't, the field
 * is `null` and the UI falls back to the raw `snapshots` series
 * (sparse per-block points, fine for low-rate streams). The
 * candle map is the natural shape for any candlestick chart
 * (TradingView, lightweight-charts, Chart.js) and for
 * stop-loss / take-profit detection in the simulation layer
 * — both can consume the aggregated series without re-walking
 * the raw snapshots.
 */
export interface IPoolHistoryDTO {
  readonly pool: TAddress;

  readonly chainId: number;

  readonly protocolId: string;

  /** Which strategy produced the series — drives the empty-state copy. */
  readonly source: 'on-chain' | 'synthetic';

  /** Human-readable explanation of how the series was produced. */
  readonly sourceDetail: string;

  /** Snapshots in ascending block order. */
  readonly snapshots: readonly IHistorySnapshotDTO[];

  /**
   * Pre-aggregated OHLC candles for the six standard timeframes
   * (`'1m' | '5m' | '15m' | '1h' | '4h' | '1d'`). `null` when the
   * caller didn't ask for candles — see {@link IGetPoolHistoryInput.withCandles}.
   */
  readonly candles: IHistoryCandleMap | null;

  /** Earliest snapshot's block number (or 0 for synthetic). */
  readonly fromBlock: bigint;

  /** Latest snapshot's block number (or 0 for synthetic). */
  readonly toBlock: bigint;

  /** Total seconds spanned by the series. */
  readonly historyWindowSeconds: bigint;

  /** Realized volatility across the series, at VOLATILITY_SCALE. */
  readonly annualizedVolatility: bigint;
}

/**
 * One point in the chart series. All numbers are bigint at fixed
 * scales so the UI can format without precision loss.
 *
 * - `timestamp` is unix seconds.
 * - `price` is `token1 per token0` at `priceDecimals` precision.
 *   The UI flips the y-axis to a more readable `token0 per token1`
 *   only when explicitly configured.
 */
export interface IHistorySnapshotDTO {
  readonly blockNumber: bigint;

  readonly timestamp: bigint;

  readonly tick: number;

  /** Token1-per-token0 at `priceDecimals`. */
  readonly price: bigint;

  readonly priceDecimals: number;
}
