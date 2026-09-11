// app/core/domains/recommendation/create_maximum_fee_strategy.factory.ts

import { MaximumFeeStrategy } from './maximum_fee_strategy.class';
import type { IMaximumFeeStrategyOptions } from './maximum_fee_strategy.class';

export function createMaximumFeeStrategy(
  options: IMaximumFeeStrategyOptions,
): MaximumFeeStrategy {
  return new MaximumFeeStrategy(options);
}