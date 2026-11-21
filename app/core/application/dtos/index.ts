// app/core/application/dtos/index.ts

export type { IPoolAnalysisDTO, ITokenSummaryDTO } from './pool_analysis.dto';
export type { IPoolTvlDTO } from './pool_tvl.dto';
export { toPoolLiquidity } from './pool_tvl.dto';
export type { IPoolTvlHistoryDTO } from './pool_tvl_history.dto';
export type {
  IPositionSimulationDTO,
  IQuoteSummaryDTO,
  IDepositSimulationDTO,
  IFuturePriceSimulationDTO,
  IHistoricalSimulationDTO,
  IMonteCarloSimulationDTO,
} from './position_simulation.dto';
export type { IHistoricalReplayDTO } from './historical_replay.dto';
export type { IRecommendationDTO, IRecommendationEntryDTO } from './recommendation.dto';
export type { IHistorySnapshotDTO, IPoolHistoryDTO } from './pool_history.dto';
export type { IHistoryCandleDTO, IHistoryCandleMap } from './candle.dto';
