// app/utils/formatDtos.ts

/**
 * Formatting helpers for the application-layer DTOs returned by
 * Phase 7 use cases. Every bigint in a DTO is at one of the
 * standard Core scales (see `app/core/math/`), so we centralize
 * the rendering logic here to avoid drift between components.
 *
 * All helpers accept the bigint + (optional) scale and return a
 * plain string the Vue template can render. We deliberately do
 * *not* use `Intl.NumberFormat` here because Phase 8 runs in the
 * browser and the scale math should never be lossy on rounding.
 */

import { APR_SCALE, IL_SCALE, SCORE_SCALE, VOLATILITY_SCALE } from '@core/math';

/**
 * One ratio at `IL_SCALE` (1e18 == 1.0). Returns a percentage
 * string with two decimal digits. Positive numbers are losses vs
 * HODL (e.g. -0.05 → "-5% IL"); the function returns the sign
 * verbatim from the input.
 */
export function formatIL(bps: bigint): string {
  const pct = Number(bps) / Number(IL_SCALE) * 100;
  return `${pct.toFixed(2)}%`;
}

/**
 * One ratio at `APR_SCALE` (1e18 == 1.0 == 100%). Returns a
 * percentage string with two decimal digits.
 */
export function formatAPR(bps: bigint): string {
  const pct = Number(bps) / Number(APR_SCALE) * 100;
  return `${pct.toFixed(2)}%`;
}

/**
 * One ratio at `VOLATILITY_SCALE` (1e18 == 1.0 == 100%).
 */
export function formatVol(bps: bigint): string {
  const pct = Number(bps) / Number(VOLATILITY_SCALE) * 100;
  return `${pct.toFixed(2)}%`;
}

/**
 * One ratio at `SCORE_SCALE` (1e18 == 1.0). Returns a four-decimal
 * score string.
 */
export function formatScore(score: bigint): string {
  return `${(Number(score) / Number(SCORE_SCALE)).toFixed(4)}`;
}

/**
 * One ratio at `1e18` where 1.0 is "no change". Returns a signed
 * percentage. Used by `cumulativeReturn` (analysis DTO).
 */
export function formatRatio1e18(bps: bigint): string {
  const ratio = Number(bps) / 1e18;
  const pct = (ratio - 1) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/**
 * Plain ratio at `1e18` (positive multiplier). Used by
 * `capitalEfficiency` (recommendation DTO), which is 1× == baseline.
 */
export function formatMultiplier1e18(bps: bigint): string {
  const ratio = Number(bps) / 1e18;
  return `${ratio.toFixed(2)}×`;
}

/**
 * Tick range as "[lower, upper]" string. Handles negative ticks
 * correctly.
 */
export function formatTickRange(lo: number, hi: number): string {
  return `[${lo}, ${hi}]`;
}

/**
 * Truncate an address for compact display: 0x1234…abcd.
 */
export function shortAddress(addr: string | `0x${string}`): string {
  if (typeof addr !== 'string' || addr.length < 10) return String(addr);
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
