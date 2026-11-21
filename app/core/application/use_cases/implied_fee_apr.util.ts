// app/core/application/use_cases/implied_fee_apr.util.ts

/**
 * Implied pool fee APR — the shared arithmetic behind the TVL
 * fallback chain (TVL-ROADMAP.md §8).
 *
 * Two application use cases need the *same* number:
 *
 *   - {@link GetPoolTvlUseCase} — the fee APR the TVL card renders.
 *   - {@link AnalyzePoolUseCase} — the fee APR echoed onto the
 *     analysis DTO when a liquidity snapshot is supplied.
 *
 * Keeping the derivation (and the sanity clamp) in one place means
 * both paths can never drift apart.
 *
 * The clamp is deliberately applied **here**, in the application
 * layer, and never in the provider: a provider reports what it
 * observed, the application decides what is credible enough to show.
 */

import { APR_SCALE, feeAprFromTurnover } from '../../math';

/**
 * `pool.fee` is expressed in hundredths of a basis point
 * (`500` == 0.05%), so the plain-fraction fee rate is `fee / 1e6`.
 */
export const FEE_RATE_DIVISOR = 1_000_000;

/**
 * An implied fee APR above 10,000%/yr is not credible — it is the
 * classic wash-trading / outlier-pool signature (TVL-ROADMAP.md §8).
 * Such values are clamped to `0n` and the UI renders "n/a" rather
 * than a fake yield.
 *
 * `APR_SCALE` is `1e18 == 100%`, so 10,000%/yr is **100×** the
 * scale unit — not 10,000× (that would be 1,000,000%/yr).
 */
export const MAX_REASONABLE_FEE_APR = 100n * APR_SCALE;

/**
 * The pool-level fee APR implied by a 24h turnover observation.
 *
 *     APR = (volume24hUsd / tvlUsd) × feeRate × 365
 *
 * Returns `0n` when:
 *   - the turnover is unknown (`volume24hUsd === 0n`),
 *   - the TVL is unknown (`tvlUsd <= 0n`),
 *   - the fee tier does not map to a fraction in (0, 1), or
 *   - the implied APR exceeds {@link MAX_REASONABLE_FEE_APR} (the
 *     outlier-pool clamp).
 *
 * `0n` therefore means "no credible APR", never "0% APR" — the UI
 * must render it as "—".
 *
 * @param fee - The pool's fee tier in hundredths of a basis point.
 * @param volume24hUsd - Rolling 24h volume, USD at `USD_DECIMALS`.
 * @param tvlUsd - Pool TVL, USD at `USD_DECIMALS`.
 * @returns APR at `APR_SCALE` (1e18 == 100%/yr).
 */
export function impliedFeeApr(
  fee: number,
  volume24hUsd: bigint,
  tvlUsd: bigint,
): bigint {
  if (tvlUsd <= 0n || volume24hUsd <= 0n) {
    return 0n;
  }

  const feeRate = fee / FEE_RATE_DIVISOR;

  if (!Number.isFinite(feeRate) || feeRate <= 0 || feeRate >= 1) {
    return 0n;
  }

  const apr = feeAprFromTurnover(volume24hUsd, tvlUsd, feeRate);

  if (apr > MAX_REASONABLE_FEE_APR) {
    // Wash trading / outlier pool — the number is noise, not a yield.
    return 0n;
  }

  return apr;
}
