// app/core/domains/simulation/create_historical_replay_simulation.factory.ts

import { HistoricalReplaySimulation } from './historical_replay_simulation.class';
import type { IHistoricalReplaySimulationOptions } from './historical_replay_simulation.class';

/**
 * Construct a {@link HistoricalReplaySimulation} bound to the given
 * {@link PoolHistory}. The simulation is otherwise stateless;
 * the factory is provided for symmetry with the rest of Core's
 * composition pattern.
 */
export function createHistoricalReplaySimulation(
  options: IHistoricalReplaySimulationOptions,
): HistoricalReplaySimulation {
  return new HistoricalReplaySimulation(options);
}
