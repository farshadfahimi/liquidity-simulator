// app/core/domains/recommendation/create_constant_range_generator.factory.ts

import type { IConstantRangeGeneratorOptions } from './constant_range_generator.class';
import { ConstantRangeGenerator } from './constant_range_generator.class';

/**
 * Construct a {@link ConstantRangeGenerator}.
 *
 * Convenience factory mirroring the Core convention of `create*` for
 * composition.
 */
export function createConstantRangeGenerator(
  options: IConstantRangeGeneratorOptions,
): ConstantRangeGenerator {
  return new ConstantRangeGenerator(options);
}
