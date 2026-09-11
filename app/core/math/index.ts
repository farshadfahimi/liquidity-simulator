// app/core/math/index.ts

/**
 * Math layer — pure, vendor-neutral numerical helpers used by the
 * domain layer. No on-chain reads, no I/O. The only types imported
 * from the rest of the Core are value objects from `@core/shared`.
 *
 * Modules:
 *   - {@link tick_math}    — V3-style tick math (sqrtPriceX96 etc.)
 *   - {@link il}           — impermanent loss
 *   - {@link capital_efficiency} — CL capital-efficiency ratios
 *   - {@link volatility}   — realized (log-return) volatility
 *   - {@link apr}          — APR from observed fees / principal
 *   - {@link scoring}      — Sharpe-like composite score
 */

export {
  MIN_TICK,
  MAX_TICK,
  sqrtRatioAtTick,
  tickToPrice,
} from './tick_math.util';

export {
  IL_SCALE,
  bigintSqrtFloor,
  ilFromPriceRatio,
  ilBetweenPrices,
} from './il.util';

export {
  CAPITAL_EFFICIENCY_SCALE,
  capitalEfficiencyRatio,
  capitalEfficiencyVsFullRange,
} from './capital_efficiency.util';

export {
  VOLATILITY_SCALE,
  SECONDS_PER_YEAR,
  realizedVolatility,
  realizedVolatilityFromPrices,
} from './volatility.util';
export type { IPriceObservation, IVolatilityResult } from './volatility.util';

export {
  APR_SCALE,
  aprFromFees,
  combinedApr,
  aprFromRawTwoLeg,
} from './apr.util';

export {
  SCORE_SCALE,
  sharpeLikeScore,
  sharpeFromWindow,
} from './scoring.util';

export {
  bigintExp,
  bigintExpRescaled,
  EXP_LN_SCALE,
  LN2_AT_LN_SCALE,
} from './lnexp.util';