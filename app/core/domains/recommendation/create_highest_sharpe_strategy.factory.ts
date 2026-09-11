// app/core/domains/recommendation/create_highest_sharpe_strategy.factory.ts

import { HighestSharpeStrategy } from './highest_sharpe_strategy.class';
import type { IHighestSharpeStrategyOptions } from './highest_sharpe_strategy.class';

export function createHighestSharpeStrategy(
  options: IHighestSharpeStrategyOptions,
): HighestSharpeStrategy {
  return new HighestSharpeStrategy(options);
}