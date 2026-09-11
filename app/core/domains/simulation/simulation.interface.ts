// app/core/domains/simulation/simulation.interface.ts

import type { Pool } from '../pool';
import type { Position } from '../position';

/**
 * Behavior contract for simulations. A simulation takes a `Pool` and
 * candidate `Position` and computes a scenario-specific output (Phase 5
 * will use this to model deposit-time / future-time / historical / MC).
 */
export interface ISimulation<TInput, TOutput> {
  readonly id: string;

  /**
   * Run the simulation. Implementations must be pure (no IO) — they
   * operate on the in-memory domain objects they receive.
   */
  run(input: TInput, pool: Pool, position: Position): TOutput;
}
