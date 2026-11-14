// app/core/domains/recommendation/constant_range_generator.class.ts

import { TickRange } from '../../shared/value_objects';
import { MAX_TICK, MIN_TICK } from '../../math';
import type { Pool } from '../pool';
import type { IRangeGenerator } from './range_generator.interface';

/**
 * Options for {@link ConstantRangeGenerator}.
 *
 * `widthsTicks` is a list of *tick spacing multiples* to apply
 * symmetrically around the current tick. Tick alignment to the pool's
 * `tickSpacing` is enforced here — the generator is tick-spacing-aware.
 */
export interface IConstantRangeGeneratorOptions {
  widthsTicks: readonly number[];
}

/**
 * Constant-width symmetric range generator around the current tick.
 *
 * Example: with `tickSpacing=60` and `widthsTicks=[100, 500, 2000]`,
 * this emits three candidates:
 *   - [tick - 100*60, tick + 100*60]
 *   - [tick - 500*60, tick + 500*60]
 *   - [tick - 2000*60, tick + 2000*60]
 *
 * Bounds are clamped to the V3 envelope (`±887272`).
 */
export class ConstantRangeGenerator implements IRangeGenerator {
  readonly id = 'constant-range';

  readonly widthsTicks: readonly number[];

  constructor(options: IConstantRangeGeneratorOptions) {
    if (options.widthsTicks.length === 0) {
      throw new Error(
        'ConstantRangeGenerator requires at least one width',
      );
    }

    for (const w of options.widthsTicks) {
      if (!Number.isInteger(w) || w <= 0) {
        throw new Error(
          `ConstantRangeGenerator width must be a positive integer, got ${w}`,
        );
      }
    }

    this.widthsTicks = [...options.widthsTicks];
  }

  generate(pool: Pool): readonly TickRange[] {
    const tickSpacing = pool.state.tickSpacing;
    const currentTick = pool.state.tick;
    // Usable bounds: the V3 envelope rounded *inward* to a multiple of
    // tickSpacing. Clamping to the raw ±887272 yields ticks that are not
    // multiples of the spacing, which a real mint would reject.
    const minUsable = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
    const maxUsable = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;

    const result: TickRange[] = [];
    for (const widthMultiples of this.widthsTicks) {
      const halfWidth = widthMultiples * tickSpacing;
      let lower = currentTick - halfWidth;
      let upper = currentTick + halfWidth;

      // Align to spacing: round down to tickSpacing grid.
      lower = Math.floor(lower / tickSpacing) * tickSpacing;
      upper = Math.ceil(upper / tickSpacing) * tickSpacing;

      // Clamp to the spacing-aligned V3 envelope.
      lower = Math.max(minUsable, lower);
      upper = Math.min(maxUsable, upper);

      if (lower >= upper) {
        continue;
      }

      result.push(new TickRange(lower, upper));
    }

    return result;
  }
}
