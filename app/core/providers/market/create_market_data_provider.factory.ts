// app/core/providers/market/create_market_data_provider.factory.ts

import { DefiLlamaMarketDataProvider } from './defi_llama_market_data_provider.class';

import type { IMarketDataProvider } from './market_data_provider.interface';

/**
 * Options accepted by {@link createMarketDataProvider}.
 *
 * Both are injection points for tests: the HTTP transport and the
 * clock. Production code calls the factory without arguments and
 * gets the real `fetch` and the system clock.
 */
export interface ICreateMarketDataProviderOptions {
  /**
   * HTTP transport used for every DefiLlama call. Defaults to the
   * global `fetch`.
   */
  readonly fetchImpl?: typeof fetch;

  /**
   * Clock in unix **seconds**. Defaults to the system clock.
   */
  readonly now?: () => bigint;
}

/**
 * Build the market-data provider.
 *
 * DefiLlama is the default (and, for now, the only) implementation
 * of {@link IMarketDataProvider}. The factory exists so the choice
 * stays in one place: a second backend (CoinGecko, a self-hosted
 * indexer) can be swapped in here without touching a single use
 * case.
 *
 * @param opts - Optional transport / clock overrides.
 * @returns The provider.
 */
export function createMarketDataProvider(
  opts: ICreateMarketDataProviderOptions = {},
): IMarketDataProvider {
  return new DefiLlamaMarketDataProvider(opts);
}
