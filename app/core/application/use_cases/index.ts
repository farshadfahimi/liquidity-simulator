// app/core/application/use_cases/index.ts

export type { TAdapterResolver } from './adapter_resolver.type';

export type {
  IDiscoverPoolsInput,
  IDiscoveredPoolDTO,
  IDiscoveredTokenDTO,
} from './discover_pools.use_case';
export { DiscoverPoolsUseCase } from './discover_pools.use_case';

export type { IAnalyzePoolInput } from './analyze_pool.use_case';
export { AnalyzePoolUseCase } from './analyze_pool.use_case';

export type { ISimulatePositionInput } from './simulate_position.use_case';
export { SimulatePositionUseCase } from './simulate_position.use_case';

export type { IReplayHistoricalPerformanceInput } from './replay_historical_performance.use_case';
export { ReplayHistoricalPerformanceUseCase } from './replay_historical_performance.use_case';

export type { ICompareStrategiesInput } from './compare_strategies.use_case';
export {
  CompareStrategiesUseCase,
  toRecommendationDTO,
} from './compare_strategies.use_case';

export type { IGetPoolHistoryInput } from './get_pool_history.use_case';
export { GetPoolHistoryUseCase } from './get_pool_history.use_case';

export type { IGetPoolTvlInput } from './get_pool_tvl.use_case';
export { GetPoolTvlUseCase } from './get_pool_tvl.use_case';

export type { IGetPoolTvlHistoryInput } from './get_pool_tvl_history.use_case';
export {
  GetPoolTvlHistoryUseCase,
  normalizeTvlPoints,
} from './get_pool_tvl_history.use_case';

export {
  FEE_RATE_DIVISOR,
  MAX_REASONABLE_FEE_APR,
  impliedFeeApr,
} from './implied_fee_apr.util';

export type {
  IAggregatableSnapshotInput,
  IAggregateHistoryInput,
} from './aggregate_history.use_case';
export { AggregateHistoryUseCase } from './aggregate_history.use_case';
