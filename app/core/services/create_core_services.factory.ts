// app/core/services/create_core_services.factory.ts

import { CoreServices, type TAdapterRegistry, type TAdapterPicker } from './core_services.class';
import { AnalyticsEngine } from '../domains/analytics';
import type { IMarketDataProvider } from '../providers/market';
import type { INetworkProvider } from '../network/network_provider.interface';

/**
 * Options for {@link createCoreServices}.
 *
 * `network` — the {@link INetworkProvider} that supplies RPC clients
 *   keyed by chainId. Required.
 *
 * `adapters` — optional pre-populated adapter registry (e.g. when
 *   the caller wants to register adapters eagerly before
 *   constructing the services).
 *
 * `analytics` — optional override for the analytics engine (useful
 *   in tests).
 *
 * `pickAdapter` — optional override for the default adapter-picker
 *   strategy.
 *
 * `market` — optional override for the market-data provider
 *   (token prices / pool liquidity / TVL history). Defaults to the
 *   DefiLlama provider built by `createMarketDataProvider()`.
 *
 * `initialChainId` — optional initial chain to activate on the
 *   network provider. Defaults to `network.current().id` (i.e. the
 *   network provider's own initial chain).
 */
export interface ICreateCoreServicesOptions {
  readonly network: INetworkProvider;

  readonly adapters?: TAdapterRegistry;

  readonly analytics?: AnalyticsEngine;

  readonly pickAdapter?: TAdapterPicker;

  readonly market?: IMarketDataProvider;
}

/**
 * Composition root for the application layer. The single entry
 * point UI code (composables, components, plugins) should use to
 * obtain use cases.
 *
 * Typical Nuxt-side usage (Phase 8):
 *
 * ```ts
 * const network = createNetworkProvider({ registry, chainId: 1 });
 * const services = createCoreServices({
 *   network,
 *   adapters: new Map([
 *     [1, [createUniswapV3Adapter({ rpc: network.rpc() })]],
 *   ]),
 * });
 * const analysis = await services.useCases().analyzePool.execute({...});
 * ```
 *
 * The factory is intentionally minimal — it just wires the inputs
 * through the {@link CoreServices} constructor. Tests bypass it and
 * instantiate {@link CoreServices} directly so they can inject
 * mocks for any field.
 */
export function createCoreServices(
  opts: ICreateCoreServicesOptions,
): CoreServices {
  return new CoreServices({
    network: opts.network,
    analytics: opts.analytics,
    adapters: opts.adapters,
    pickAdapter: opts.pickAdapter,
    market: opts.market,
  });
}
