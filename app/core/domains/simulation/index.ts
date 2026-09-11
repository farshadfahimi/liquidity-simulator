// app/core/domains/simulation/index.ts

export type { ISimulation } from './simulation.interface';

export type {
  IDepositSimulationInput,
  IDepositSimulationOutput,
} from './deposit_simulation.class';
export { DepositSimulation } from './deposit_simulation.class';
export { createDepositSimulation } from './create_deposit_simulation.factory';

export type {
  IFuturePriceSimulationInput,
  IFuturePriceSimulationOutput,
} from './future_price_simulation.class';
export { FuturePriceSimulation } from './future_price_simulation.class';
export { createFuturePriceSimulation } from './create_future_price_simulation.factory';

export type {
  IHistoricalReplaySample,
  IHistoricalReplaySimulationInput,
  IHistoricalReplaySimulationOptions,
  IHistoricalReplaySimulationOutput,
} from './historical_replay_simulation.class';
export { HistoricalReplaySimulation } from './historical_replay_simulation.class';
export { createHistoricalReplaySimulation } from './create_historical_replay_simulation.factory';

export type {
  IMonteCarloPathResult,
  IMonteCarloSample,
  IMonteCarloSimulationInput,
  IMonteCarloSimulationOutput,
  IMonteCarloSummary,
} from './monte_carlo_simulation.class';
export { MonteCarloSimulation } from './monte_carlo_simulation.class';
export { createMonteCarloSimulation } from './create_monte_carlo_simulation.factory';
