// app/core/domains/recommendation/create_balanced_strategy.factory.ts

import { BalancedStrategy } from './balanced_strategy.class';
import type { IBalancedStrategyOptions } from './balanced_strategy.class';

export function createBalancedStrategy(
  options: IBalancedStrategyOptions,
): BalancedStrategy {
  return new BalancedStrategy(options);
}