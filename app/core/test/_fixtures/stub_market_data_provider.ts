// app/core/test/_fixtures/stub_market_data_provider.ts
//
// In-memory IMarketDataProvider stub for unit tests. It serves a
// caller-supplied price table / liquidity snapshot / TVL history and
// records the calls it received, so a use case can be tested without
// a network and without a DefiLlama account.
//
// Mirrors `stub_rpc_provider.ts`: the contract methods exist so the
// stub *type-checks* as IMarketDataProvider, and the accessors record
// what was asked for.

import type { IMarketDataProvider } from '@core/providers/market';
import type {
  TAddress,
  TPoolLiquidity,
  TPoolTvlPoint,
  TTokenPrice,
} from '@core/shared/types';

/** What the stub serves. */
export interface IStubMarketDataOptions {
  /** Prices the stub knows, keyed by lower-cased token address. */
  readonly prices?: readonly TTokenPrice[];

  /** The liquidity snapshot the stub serves (default: `null`). */
  readonly liquidity?: TPoolLiquidity | null;

  /** The TVL history the stub serves (default: `null`). */
  readonly history?: readonly TPoolTvlPoint[] | null;
}

/** A stub market-data provider plus the calls it received. */
export interface IStubMarketDataProvider {
  readonly provider: IMarketDataProvider;

  /** `(chainId, token)` pairs asked for, in call order. */
  readonly priceCalls: readonly (readonly [number, readonly TAddress[]])[];

  /** Pools asked for, in call order. */
  readonly liquidityCalls: readonly (readonly [number, TAddress])[];

  /** Pools whose history was asked for, in call order. */
  readonly historyCalls: readonly (readonly [number, TAddress])[];
}

/**
 * Build a stub market-data provider.
 *
 * @param options - The prices / liquidity / history to serve.
 * @returns The provider and the call log.
 */
export function createStubMarketDataProvider(
  options: IStubMarketDataOptions = {},
): IStubMarketDataProvider {
  const prices = new Map<string, TTokenPrice>();

  for (const price of options.prices ?? []) {
    prices.set(price.token.toLowerCase(), price);
  }

  const priceCalls: (readonly [number, readonly TAddress[]])[] = [];
  const liquidityCalls: (readonly [number, TAddress])[] = [];
  const historyCalls: (readonly [number, TAddress])[] = [];

  const provider: IMarketDataProvider = {
    id: 'stub-market-data',
    name: 'Stub Market Data',
    version: '1',

    async getTokenPrices(
      chainId: number,
      tokens: readonly TAddress[],
    ): Promise<readonly TTokenPrice[]> {
      priceCalls.push([chainId, tokens]);

      return tokens
        .map((token) => prices.get(token.toLowerCase()))
        .filter((price): price is TTokenPrice => price !== undefined);
    },

    async getPoolLiquidity(
      chainId: number,
      _protocolId: string,
      pool: TAddress,
    ): Promise<TPoolLiquidity | null> {
      liquidityCalls.push([chainId, pool]);

      return options.liquidity ?? null;
    },

    async getPoolTvlHistory(
      chainId: number,
      pool: TAddress,
    ): Promise<readonly TPoolTvlPoint[] | null> {
      historyCalls.push([chainId, pool]);

      return options.history ?? null;
    },
  };

  return {
    provider,
    priceCalls,
    liquidityCalls,
    historyCalls,
  };
}
