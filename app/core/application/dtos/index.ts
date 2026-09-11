// app/core/application/dtos/index.ts

export type { IPoolAnalysisDTO, ITokenSummaryDTO } from './pool_analysis.dto';
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
