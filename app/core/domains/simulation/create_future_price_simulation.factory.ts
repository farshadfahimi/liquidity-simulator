// app/core/domains/simulation/create_future_price_simulation.factory.ts

import { FuturePriceSimulation } from './future_price_simulation.class';

/**
 * Construct a {@link FuturePriceSimulation}. The simulation is
 * stateless; the factory is kept for symmetry with the rest of
 * Core's composition pattern.
 */
export function createFuturePriceSimulation(): FuturePriceSimulation {
  return new FuturePriceSimulation();
}
