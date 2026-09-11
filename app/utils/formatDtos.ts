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
 *
 * This module also re-exports a few pure-utility helpers from
 * `@core/shared/utils` so that Nuxt's standard auto-import
 * (which scans `app/utils/`) makes them available in templates
 * without an explicit import line in every component.
 */

import { APR_SCALE, IL_SCALE, SCORE_SCALE, VOLATILITY_SCALE } from '@core/math';
import { formatAmountShort } from '@core/shared/utils';

export { formatAmountShort };

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
 * Bigint raw-units -> compact human string, given the token's
 * decimals. Thin wrapper over `formatAmountShort` that fixes the
 * `fractionDigits` at 6 — that's enough precision for any
 * on-chain display without spamming trailing zeros.
 */
export function formatTokenAmount(raw: bigint, decimals: number): string {
  return formatAmountShort(raw, decimals, 6);
}

/**
 * Compact numeraire price: `1.2345` at `priceDecimals`. Mirrors
 * `formatTokenAmount` semantically but kept as its own helper so
 * the call site reads clearly.
 */
export function formatPriceShort(raw: bigint, priceDecimals: number): string {
  return formatAmountShort(raw, priceDecimals, 6);
}

/**
 * `bigint` seconds -> `"Nd HH:MM:SS"`-style human string. Used
 * for simulation horizons and total replay time.
 */
export function formatSeconds(totalSeconds: bigint): string {
  const sec = Number(totalSeconds);
  if (!Number.isFinite(sec) || sec < 0) return '—';
  if (sec < 60) return `${sec.toFixed(0)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${(sec % 60).toFixed(0)}s`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}h ${m.toFixed(0)}m`;
  }
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return `${d}d ${h}h`;
}

/**
 * Truncate an address for compact display: 0x1234…abcd.
 */
export function shortAddress(addr: string | `0x${string}`): string {
  if (typeof addr !== 'string' || addr.length < 10) return String(addr);
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
