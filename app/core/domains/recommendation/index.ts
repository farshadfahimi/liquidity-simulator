// app/core/domains/recommendation/index.ts

// Interfaces
export type { IRangeGenerator } from './range_generator.interface';
export type { IRecommendationFields, IRecommendation } from './recommendation.value-object';
export type {
  IRecommendationSetContext,
} from './recommendation_set.value-object';
export type { IScoringConfigFields } from './scoring_config.value-object';

// Value objects
export { Recommendation } from './recommendation.value-object';
export { RecommendationSet } from './recommendation_set.value-object';
export { ScoringConfig, defaultScoringConfig, createScoringConfig } from './scoring_config.value-object';

// Range generators (Phase 3)
export type { IConstantRangeGeneratorOptions } from './constant_range_generator.class';
export { ConstantRangeGenerator } from './constant_range_generator.class';
export { createConstantRangeGenerator } from './create_constant_range_generator.factory';

export type { IVolatilityAdjustedRangeGeneratorOptions } from './volatility_adjusted_range_generator.class';
export { VolatilityAdjustedRangeGenerator } from './volatility_adjusted_range_generator.class';
export { createVolatilityAdjustedRangeGenerator } from './create_volatility_adjusted_range_generator.factory';

// Concrete recommendation strategies (Phase 6)
export type { IBalancedStrategyOptions } from './balanced_strategy.class';
export { BalancedStrategy } from './balanced_strategy.class';
export { createBalancedStrategy } from './create_balanced_strategy.factory';

export type { IHighestSharpeStrategyOptions } from './highest_sharpe_strategy.class';
export { HighestSharpeStrategy } from './highest_sharpe_strategy.class';
export { createHighestSharpeStrategy } from './create_highest_sharpe_strategy.factory';

export type { IMaximumFeeStrategyOptions } from './maximum_fee_strategy.class';
export { MaximumFeeStrategy } from './maximum_fee_strategy.class';
export { createMaximumFeeStrategy } from './create_maximum_fee_strategy.factory';

export type { ILowestRiskStrategyOptions } from './lowest_risk_strategy.class';
export { LowestRiskStrategy } from './lowest_risk_strategy.class';
export { createLowestRiskStrategy } from './create_lowest_risk_strategy.factory';

export { HighestCapitalEfficiencyStrategy } from './highest_capital_efficiency_strategy.class';
export { createHighestCapitalEfficiencyStrategy } from './create_highest_capital_efficiency_strategy.factory';

// Recommendation engine
export type { IRecommendInput } from './recommendation_engine.class';
export { RecommendationEngine } from './recommendation_engine.class';
export { createRecommendationEngine } from './create_recommendation_engine.factory';