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
