// app/core/domains/recommendation/create_volatility_adjusted_range_generator.factory.ts

import {
  VolatilityAdjustedRangeGenerator,
} from './volatility_adjusted_range_generator.class';
import type {
  IVolatilityAdjustedRangeGeneratorOptions,
} from './volatility_adjusted_range_generator.class';

/**
 * Factory for {@link VolatilityAdjustedRangeGenerator}. Just a
 * pass-through for now; exists so the convention
 * `create<Name>(options)` is uniform across the recommendation layer.
 */
export function createVolatilityAdjustedRangeGenerator(
  options: IVolatilityAdjustedRangeGeneratorOptions,
): VolatilityAdjustedRangeGenerator {
  return new VolatilityAdjustedRangeGenerator(options);
}