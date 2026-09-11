// app/core/math/tick_math.util.ts

/**
 * Pure, vendor-neutral tick math for V3-class concentrated-liquidity
 * pools. No SDK or external dependency; the algorithm is the public
 * V3 spec (Uniswap's `TickMath`) ported line-for-line.
 *
 * The math is shared across all V3-style AMMs (Uniswap V3, Shadow CL,
 * PancakeSwap V3, ...) — keeping it here means the math layer is
 * truly protocol-agnostic.
 *
 * NOTE: bit-magic constants and shifts are intentional; do not "clean
 * up" without cross-checking against the V3 reference.
 */
import { Price } from '../shared/value_objects';

/** V3 spec tick envelope. */
export const MIN_TICK = -887272;

/** V3 spec tick envelope. */
export const MAX_TICK = 887272;

const Q32 = 2n ** 32n;
const Q96 = 2n ** 96n;
const Q128 = 2n ** 128n;
const Q192 = Q96 * Q96;

/**
 * JavaScript's `>>` shifts bigints by at most 32 bits (the shift count
 * is converted to a 32-bit signed int). For V3's spec which shifts by
 * 128 bits, use this helper which divides by 2^shift.
 */
function shr128(value: bigint): bigint {
  return value / Q128;
}

/** 2^256 - 1 — used to invert the ratio for positive ticks. */
const MAX_UINT256 = (1n << 256n) - 1n;

interface IMulShiftConstants {
  readonly initialOdd: bigint;
  readonly initialEven: bigint;
  readonly steps: readonly bigint[];
}

const TICK_TO_SQRT_CONSTANTS: IMulShiftConstants = {
  initialOdd: 0xfffcb933bd6fad37aa2d162d1a594001n,
  initialEven: 0x100000000000000000000000000000000n,
  steps: [
    // Each entry multiplies and shifts right by 128.
    0xfff97272373d413259a46990580e213an,
    0xfff2e50f5f656932ef12357cf3c7fdccn,
    0xffe5caca7e10e4e61c3624eaa0941cd0n,
    0xffcb9843d60f6159c9db58835c926644n,
    0xff973b41fa98c081472e6896dfb254c0n,
    0xff2ea16466c96a3843ec78b326b52861n,
    0xfe5dee046a99a2a811c461f1969c3053n,
    0xfcbe86c7900a88aedcffc83b479aa3a4n,
    0xf987a7253ac413176f2b074cf7815e54n,
    0xf3392b0822b70005940c7a398e4b70f3n,
    0xe7159475a2c29b7443b29c7fa6e889d9n,
    0xd097f3bdfd2022b8845ad8f792aa5825n,
    0xa9f746462d870fdf8a65dc1f90e061e5n,
    0x70d869a156d2a1b890bb3df62baf32f7n,
    0x31be135f97d08fd981231505542fcfa6n,
    0x9aa508b5b7a84e1c677de54f3e99bc9n,
    0x5d6af8dedb81196699c329225ee604n,
    0x2216e584f5fa1ea926041bedfe98n,
    0x48a170391f7dc42444e8fa2n,
  ],
};

/**
 * Compute `sqrt(1.0001^tick)`, expressed as a Q64.96 fixed-point bigint.
 * Matches V3's `TickMath.getSqrtRatioAtTick` exactly.
 */
export function sqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick)) {
    throw new Error(`tick must be an integer, got ${tick}`);
  }

  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(
      `tick out of bounds [${MIN_TICK}, ${MAX_TICK}], got ${tick}`,
    );
  }

  const absTick = tick < 0 ? -tick : tick;

  let ratio: bigint = (absTick & 0x1) !== 0
    ? TICK_TO_SQRT_CONSTANTS.initialOdd
    : TICK_TO_SQRT_CONSTANTS.initialEven;

  for (let i = 0; i < TICK_TO_SQRT_CONSTANTS.steps.length; i++) {
    if ((absTick & (1 << (i + 1))) !== 0) {
      const mul = TICK_TO_SQRT_CONSTANTS.steps[i]!;
      // Multiply (Q128.128 * Q128.128) then shift right 128 → Q128.
      ratio = shr128(ratio * mul);
    }
  }

  if (tick > 0) {
    ratio = MAX_UINT256 / ratio;
  }

  // Convert Q128 back to Q64.96 with rounding up.
  const rem = ratio % Q32;
  return rem === 0n ? ratio / Q32 : ratio / Q32 + 1n;
}

/**
 * Compute `1.0001^tick` as a `Price` at `decimals` of precision
 * (default 18). The price is `token1 per token0`, matching how
 * `sqrtPriceX96` encodes it.
 *
 * @param tick - Tick index (must be in `[MIN_TICK, MAX_TICK]`).
 * @param token0Decimals - Decimals of token0.
 * @param token1Decimals - Decimals of token1.
 * @param decimals - Output scale (default 18).
 */
export function tickToPrice(
  tick: number,
  token0Decimals: number,
  token1Decimals: number,
  decimals: number = 18,
): Price {
  if (token0Decimals < 0 || !Number.isInteger(token0Decimals)) {
    throw new Error(
      `tickToPrice: token0Decimals invalid: ${token0Decimals}`,
    );
  }

  if (token1Decimals < 0 || !Number.isInteger(token1Decimals)) {
    throw new Error(
      `tickToPrice: token1Decimals invalid: ${token1Decimals}`,
    );
  }

  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new Error(
      `tickToPrice: decimals invalid: ${decimals}`,
    );
  }

  const sqrtRatioX96 = sqrtRatioAtTick(tick);

  // See {@link sqrtPriceX96ToPrice} for the math derivation.
  // The target scale here must be `token0Decimals - token1Decimals + decimals`
  // (not the inverse) so the resulting `value / 10^decimals == price_human`.
  const targetScale = token0Decimals - token1Decimals + decimals;

  const numerator = sqrtRatioX96 * sqrtRatioX96;
  const scaled = targetScale >= 0
    ? numerator * 10n ** BigInt(targetScale)
    : numerator / 10n ** BigInt(-targetScale);

  return new Price(scaled / Q192, decimals);
}
