// app/core/shared/types/token_price.type.ts

import type { TAddress } from './address.type';

/**
 * A USD price for one token, observed at a point in time.
 *
 * Money convention (TVL-ROADMAP §5.1): token USD **prices** live at
 * `USD_PRICE_DECIMALS` (18) — they multiply raw token amounts, so
 * they must keep the full precision. USD **amounts** (TVL, volume)
 * live at `USD_DECIMALS` (6). Never mix the two scales.
 */
export interface TTokenPrice {
  /** The priced token. */
  readonly token: TAddress;

  /** USD price at 1e18 scale (1797.89 USD → `1797896200000000000000n`). */
  readonly usdPrice: bigint;

  /**
   * Provider confidence ∈ [0,1], at 1e18 scale (`0.99` →
   * `990000000000000000n`). `0n` means "no confidence reported".
   */
  readonly confidence: bigint;

  /** Unix seconds of the price observation. */
  readonly timestamp: bigint;
}
