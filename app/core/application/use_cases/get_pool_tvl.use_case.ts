// app/core/application/use_cases/get_pool_tvl.use_case.ts

import type { TAddress, TPoolLiquidity, TPoolLiquiditySource, TTokenPrice } from '../../shared/types';
import { isStablecoinSymbol } from '../../shared/utils';
import type { TPoolState } from '../../adapters/types';
import { Pool } from '../../domains/pool';
import { AnalyticsEngine } from '../../domains/analytics';
import type { IMarketDataProvider } from '../../providers/market';
import { InvalidUseCaseInputError } from '../errors/invalid_input_error';
import type { IPoolTvlDTO } from '../dtos/pool_tvl.dto';
import type { TAdapterResolver } from './adapter_resolver.type';
import { impliedFeeApr } from './implied_fee_apr.util';

/**
 * Input for {@link GetPoolTvlUseCase}.
 *
 * `notionalUsd` is optional: when supplied (USD at `USD_DECIMALS`)
 * the DTO also carries `positionShare` — the deposit's share of the
 * pool, the exit-impact guard.
 */
export interface IGetPoolTvlInput {
  /** The pool to report on. */
  readonly pool: TAddress;

  /** Chain the pool lives on. */
  readonly chainId: number;

  /** Optional protocol id — resolved through the adapter registry. */
  readonly protocolId?: string;

  /** Optional deposit notional in USD at `USD_DECIMALS` (6). */
  readonly notionalUsd?: bigint;
}

/** Scale of the USD **prices** used in the arithmetic (1e18 == $1.00). */
const PRICE_DECIMALS = 18;

/** $1.00 at the 1e18 price scale — the stablecoin anchor. */
const ONE_USD_PRICE = 10n ** 18n;

/**
 * The indexed (DefiLlama) TVL is considered stale when it is less
 * than a fiftieth of the on-chain virtual-reserve estimate — the
 * index has not caught up with the pool (TVL-ROADMAP.md §8).
 */
const STALE_INDEX_RATIO = 50n;

/** Wall-clock seconds — the default timestamp source. */
function defaultNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/** Find a provider price for `token`, ignoring address casing. */
function findPrice(
  prices: readonly TTokenPrice[],
  token: TAddress,
): bigint | undefined {
  const wanted = token.toLowerCase();
  const match = prices.find((p) => p.token.toLowerCase() === wanted);

  if (!match || match.usdPrice <= 0n) {
    return undefined;
  }

  return match.usdPrice;
}

/**
 * Get-pool-TVL use case: the **UI-ready liquidity summary** of one
 * pool, assembled through the full fallback chain.
 *
 * The chain (TVL-ROADMAP.md §8), best → weakest:
 *
 *   1. `defi-llama` — the provider's indexed snapshot. Best number
 *      we have; only as fresh as the index.
 *   2. `on-chain-estimates` — virtual reserves valued at the
 *      provider's USD prices for *both* legs.
 *   3. `on-chain-estimates` — virtual reserves valued with **one**
 *      leg priced and the other derived from the pool's own on-chain
 *      price ratio. When the provider gives us no price at all, a
 *      stablecoin leg is anchored at $1.00 and the other leg is
 *      derived the same way.
 *   4. `token-units` — virtual reserves with no USD valuation.
 *      `tvlUsd` is `0n`; the two legs are still reported in token
 *      units.
 *
 * The UI **always** gets something renderable: the virtual-reserve
 * legs come from the pool state we already fetch, so tier 4 needs no
 * external data at all.
 *
 * Two sanity clamps are applied here (never in the provider, per
 * TVL-ROADMAP.md §8):
 *
 *   - an indexed TVL below `on-chain estimate / 50` is treated as a
 *     stale index and the on-chain number wins;
 *   - an implied fee APR above 10,000%/yr is clamped to `0n`.
 *
 * The use case never throws for missing market data — every provider
 * failure degrades to the next tier.
 */
export class GetPoolTvlUseCase {
  readonly id = 'get-pool-tvl';

  constructor(
    private readonly resolveAdapter: TAdapterResolver,
    private readonly market: IMarketDataProvider,
    private readonly analytics: AnalyticsEngine = new AnalyticsEngine(),
    private readonly now: () => bigint = defaultNow,
  ) {}

  async execute(input: IGetPoolTvlInput): Promise<IPoolTvlDTO> {
    if (!input.pool) {
      throw new InvalidUseCaseInputError(this.id, 'pool', 'address is required');
    }

    if (
      input.chainId === undefined
      || input.chainId === null
      || !Number.isInteger(input.chainId)
      || input.chainId <= 0
    ) {
      throw new InvalidUseCaseInputError(this.id, 'chainId', 'must be a positive integer');
    }

    if (input.notionalUsd !== undefined && input.notionalUsd < 0n) {
      throw new InvalidUseCaseInputError(this.id, 'notionalUsd', 'must be non-negative');
    }

    const adapter = this.resolveAdapter(input.chainId, input.protocolId);
    const state = await adapter.getPoolState(input.pool);
    const pool = new Pool(state, input.chainId);

    // Virtual reserves are always available — they only need the
    // pool state we just fetched.
    const reserves = pool.virtualReserves();

    // The two external reads. Both are best-effort: a provider that
    // fails simply moves us down the fallback chain.
    const [indexed, prices] = await Promise.all([
      this.readLiquidity(input.chainId, adapter.id, state),
      this.readPrices(input.chainId, state),
    ]);

    // The on-chain estimate (tiers 2 and 3).
    const priced = this.resolveUsdPrices(pool, state, prices);
    const onChainTvl = priced
      ? this.analytics.poolTvlOnChain(pool, priced.token0Usd, priced.token1Usd)
      : 0n;

    // ---- tier selection -------------------------------------------------
    let tvlUsd = 0n;
    let volume24hUsd = 0n;
    let source: TPoolLiquiditySource = 'token-units';
    let externalPoolId: string | undefined;
    let timestamp = this.now();

    const indexedIsStale = indexed !== null
      && indexed.tvlUsd > 0n
      && onChainTvl > 0n
      && indexed.tvlUsd * STALE_INDEX_RATIO < onChainTvl;

    if (indexed !== null && indexed.tvlUsd > 0n && !indexedIsStale) {
      // Tier 1 — the indexed market value.
      tvlUsd = indexed.tvlUsd;
      volume24hUsd = indexed.volume24hUsd;
      source = 'defi-llama';
      externalPoolId = indexed.externalPoolId;
      timestamp = indexed.timestamp;
    }
    else if (onChainTvl > 0n) {
      // Tier 2 / 3 — the on-chain estimate.
      tvlUsd = onChainTvl;
      source = 'on-chain-estimates';
    }

    // ---- implied fee APR ------------------------------------------------
    const feeApr = impliedFeeApr(state.fee, volume24hUsd, tvlUsd);

    // ---- exit-impact guard ----------------------------------------------
    const positionShare = this.analytics.positionShareOfPool(
      input.notionalUsd ?? 0n,
      tvlUsd,
    );

    return {
      pool: input.pool,
      chainId: input.chainId,
      protocolId: adapter.id,
      tvlUsd,
      volume24hUsd,
      feeApr,
      amount0Raw: reserves.amount0Raw,
      amount1Raw: reserves.amount1Raw,
      positionShare,
      source,
      ...(externalPoolId !== undefined ? { externalPoolId } : {}),
      timestamp,
    };
  }

  /**
   * Read the indexed liquidity snapshot, degrading to `null` on any
   * failure (providers are contractually non-throwing, but the use
   * case must not be the thing that breaks).
   */
  private async readLiquidity(
    chainId: number,
    protocolId: string,
    state: TPoolState,
  ): Promise<TPoolLiquidity | null> {
    try {
      return await this.market.getPoolLiquidity(
        chainId,
        protocolId,
        state.pool,
        state.token0.address,
        state.token1.address,
        state.fee,
      );
    }
    catch {
      return null;
    }
  }

  /** Read the USD prices for both legs, degrading to `[]`. */
  private async readPrices(
    chainId: number,
    state: TPoolState,
  ): Promise<readonly TTokenPrice[]> {
    try {
      return await this.market.getTokenPrices(chainId, [
        state.token0.address,
        state.token1.address,
      ]);
    }
    catch {
      return [];
    }
  }

  /**
   * Resolve the USD price of both legs.
   *
   * Preference order:
   *   1. both legs priced by the provider;
   *   2. one leg priced → the other is derived from the pool's own
   *      on-chain price ratio (token1 per token0);
   *   3. no prices → a stablecoin leg is anchored at $1.00 and the
   *      other leg is derived from the same ratio.
   *
   * Returns `null` when no USD valuation is possible at all (tier 4).
   */
  private resolveUsdPrices(
    pool: Pool,
    state: TPoolState,
    prices: readonly TTokenPrice[],
  ): { readonly token0Usd: bigint; readonly token1Usd: bigint } | null {
    const price0 = findPrice(prices, state.token0.address);
    const price1 = findPrice(prices, state.token1.address);

    if (price0 !== undefined && price1 !== undefined) {
      return { token0Usd: price0, token1Usd: price1 };
    }

    // The pool price is *token1 per token0*, at 18 decimals.
    const price = pool.currentPrice(PRICE_DECIMALS);

    if (price.value <= 0n) {
      return null;
    }

    // usd(token1) = usd(token0) / p   and   usd(token0) = usd(token1) * p
    if (price0 !== undefined) {
      return {
        token0Usd: price0,
        token1Usd: (price0 * 10n ** 18n) / price.value,
      };
    }

    if (price1 !== undefined) {
      return {
        token0Usd: (price1 * price.value) / 10n ** 18n,
        token1Usd: price1,
      };
    }

    // No provider price at all — anchor a stablecoin leg at $1.00.
    if (isStablecoinSymbol(state.token0.symbol)) {
      return {
        token0Usd: ONE_USD_PRICE,
        token1Usd: (ONE_USD_PRICE * 10n ** 18n) / price.value,
      };
    }

    if (isStablecoinSymbol(state.token1.symbol)) {
      return {
        token0Usd: (ONE_USD_PRICE * price.value) / 10n ** 18n,
        token1Usd: ONE_USD_PRICE,
      };
    }

    return null;
  }
}
