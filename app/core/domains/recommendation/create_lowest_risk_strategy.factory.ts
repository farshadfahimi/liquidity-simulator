// app/core/domains/recommendation/create_lowest_risk_strategy.factory.ts

import { LowestRiskStrategy } from './lowest_risk_strategy.class';
import type { ILowestRiskStrategyOptions } from './lowest_risk_strategy.class';

export function createLowestRiskStrategy(
  options: ILowestRiskStrategyOptions,
): LowestRiskStrategy {
  return new LowestRiskStrategy(options);
}