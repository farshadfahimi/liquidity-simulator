// app/core/domains/simulation/create_deposit_simulation.factory.ts

import { DepositSimulation } from './deposit_simulation.class';

/**
 * Construct a {@link DepositSimulation}. The simulation is stateless;
 * the factory is provided for symmetry with the rest of Core's
 * composition pattern.
 */
export function createDepositSimulation(): DepositSimulation {
  return new DepositSimulation();
}
