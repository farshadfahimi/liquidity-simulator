// app/core/domains/recommendation/range_generator.interface.ts

import type { Pool } from '../pool';
import type { TickRange } from '../../shared/value_objects';

/**
 * Behavior contract for "candidate range" generators. A range generator
 * looks at a {@link Pool} and proposes one or more {@link TickRange}
 * candidates that LP candidates might use.
 *
 * Implementations live in this folder (or under plugins at the
 * application layer). Examples:
 *   - {@link ConstantRangeGenerator}: ±X% symmetric around current tick.
 *   - Tick-spacing-aware width generators (Phase 4).
 *   - Volatility-adjusted generators (Phase 4).
 */
export interface IRangeGenerator {
  readonly id: string;

  /**
   * Generate candidate tick ranges for `pool`.
   */
  generate(pool: Pool): readonly TickRange[];
}
