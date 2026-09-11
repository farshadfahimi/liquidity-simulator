// app/core/domains/recommendation/create_highest_capital_efficiency_strategy.factory.ts

import { HighestCapitalEfficiencyStrategy } from './highest_capital_efficiency_strategy.class';

export function createHighestCapitalEfficiencyStrategy(): HighestCapitalEfficiencyStrategy {
  return new HighestCapitalEfficiencyStrategy();
}