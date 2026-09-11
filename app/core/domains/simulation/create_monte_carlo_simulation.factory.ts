// app/core/domains/simulation/create_monte_carlo_simulation.factory.ts

import { MonteCarloSimulation } from './monte_carlo_simulation.class';

/**
 * Construct a {@link MonteCarloSimulation}. The simulation is
 * stateless apart from the PRNG seed supplied at run time;
 * the factory is provided for symmetry with the rest of Core's
 * composition pattern.
 */
export function createMonteCarloSimulation(): MonteCarloSimulation {
  return new MonteCarloSimulation();
}
