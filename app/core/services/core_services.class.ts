// app/core/services/core_services.class.ts

import { AnalyticsEngine } from '../domains/analytics';
import {
  DiscoverPoolsUseCase,
  AnalyzePoolUseCase,
  SimulatePositionUseCase,
  ReplayHistoricalPerformanceUseCase,
  CompareStrategiesUseCase,
  GetPoolHistoryUseCase,
  GetPoolTvlUseCase,
  GetPoolTvlHistoryUseCase,
  type TAdapterResolver,
} from '../application/use_cases';
import { AdapterNotFoundError } from '../application/errors/adapter_not_found_error';
import type { IProtocolAdapter } from '../adapters/protocol_adapter.interface';
import type { IRpcProvider } from '../providers/rpc';
import {
  createMarketDataProvider,
  type IMarketDataProvider,
} from '../providers/market';
import type { INetworkProvider } from '../network/network_provider.interface';

/**
 * Map of `chainId → list of registered adapters`. Use cases consult
 * this map through the {@link TAdapterResolver} injected at use-case
 * construction time.
 *
 * The composition root populates it via {@link registerAdapter};
 * tests can populate it directly with a single mock adapter per
 * chain.
 */
export type TAdapterRegistry = Map<number, IProtocolAdapter[]>;

/**
 * Strategy for choosing among multiple registered adapters on the
 * same chain. Default: prefer the adapter whose `id` matches
 * `protocolId` if provided, else the *first* registered adapter
 * for that chain. Callers wanting stricter behaviour (e.g. "must
 * match protocolId, fail otherwise") can pass a custom strategy.
 */
export type TAdapterPicker = (
  chainId: number,
  protocolId: string | undefined,
  registered: readonly IProtocolAdapter[],
) => IProtocolAdapter | undefined;

/**
 * Top-level services bundle. Holds the cross-cutting singletons
 * (network provider, analytics engine, adapter registry) and
 * exposes factory methods for the application-layer use cases.
 *
 * Use cases are *not* constructed eagerly: callers ask for them
 * via {@link useCases}, which returns a fresh use-case bundle each
 * time. This keeps each use case independent and testable.
 */
export class CoreServices {
  readonly id = 'core-services';

  readonly network: INetworkProvider;

  readonly analytics: AnalyticsEngine;

  readonly adapters: TAdapterRegistry;

  /**
   * The market-data provider (token prices, pool liquidity, TVL
   * history). Defaults to the DefiLlama provider; tests inject a
   * stub instead. It is held here so every use-case bundle built by
   * {@link useCases} shares the same provider — and therefore the
   * same in-memory caches.
   */
  readonly market: IMarketDataProvider;

  private readonly pickAdapter: TAdapterPicker;

  constructor(opts: {
    network: INetworkProvider;
    analytics?: AnalyticsEngine;
    adapters?: TAdapterRegistry;
    pickAdapter?: TAdapterPicker;
    market?: IMarketDataProvider;
  }) {
    this.network = opts.network;
    this.analytics = opts.analytics ?? new AnalyticsEngine();
    this.adapters = opts.adapters ?? new Map();
    this.pickAdapter = opts.pickAdapter ?? defaultAdapterPicker;
    this.market = opts.market ?? createMarketDataProvider();
  }

  /** Register an adapter under its chain. */
  registerAdapter(chainId: number, adapter: IProtocolAdapter): void {
    const list = this.adapters.get(chainId) ?? [];

    list.push(adapter);
    this.adapters.set(chainId, list);
  }

  /** Drop every registered adapter for a chain. */
  clearAdapters(chainId: number): void {
    this.adapters.delete(chainId);
  }

  /** Current RPC for the active network. */
  rpc(): IRpcProvider {
    return this.network.rpc();
  }

  /**
   * Resolve an adapter for `chainId` (and optional `protocolId`).
   * Throws {@link AdapterNotFoundError} when no adapter matches.
   */
  resolveAdapter(chainId: number, protocolId?: string): IProtocolAdapter {
    const registered = this.adapters.get(chainId) ?? [];
    const adapter = this.pickAdapter(chainId, protocolId, registered);

    if (!adapter) {
      throw new AdapterNotFoundError(
        'core-services',
        chainId,
        protocolId,
      );
    }

    return adapter;
  }

  /**
   * Build a fresh use-case bundle bound to this services instance.
   * Each call returns a *new* bundle — use cases don't share state.
   */
  useCases(): ICoreUseCases {
    const resolver: TAdapterResolver = (chainId, protocolId) =>
      this.resolveAdapter(chainId, protocolId);

    return {
      discoverPools: new DiscoverPoolsUseCase(resolver),
      analyzePool: new AnalyzePoolUseCase(resolver, this.analytics),
      simulatePosition: new SimulatePositionUseCase(resolver),
      replayHistoricalPerformance: new ReplayHistoricalPerformanceUseCase(),
      compareStrategies: new CompareStrategiesUseCase(),
      getPoolHistory: new GetPoolHistoryUseCase(
        resolver,
        () => this.rpc(),
        this.analytics,
      ),
      getPoolTvl: new GetPoolTvlUseCase(
        resolver,
        this.market,
        this.analytics,
      ),
      getPoolTvlHistory: new GetPoolTvlHistoryUseCase(
        resolver,
        this.market,
      ),
    };
  }
}

/**
 * Default adapter picker.
 *
 * Rules (in order):
 *   1. If `protocolId` is supplied, prefer an adapter whose `id`
 *      matches it exactly.
 *   2. Otherwise, return the *first* registered adapter for the
 *      chain.
 *   3. If no registered adapter exists, return `undefined` (the
 *      caller throws {@link AdapterNotFoundError}).
 */
export function defaultAdapterPicker(
  _chainId: number,
  protocolId: string | undefined,
  registered: readonly IProtocolAdapter[],
): IProtocolAdapter | undefined {
  if (protocolId) {
    const match = registered.find((a) => a.id === protocolId);

    if (match) {
      return match;
    }
  }

  return registered[0];
}

/**
 * Bundle of use cases returned by {@link CoreServices.useCases}.
 * Each field is a ready-to-use use-case instance.
 */
export interface ICoreUseCases {
  readonly discoverPools: DiscoverPoolsUseCase;

  readonly analyzePool: AnalyzePoolUseCase;

  readonly simulatePosition: SimulatePositionUseCase;

  readonly replayHistoricalPerformance: ReplayHistoricalPerformanceUseCase;

  readonly compareStrategies: CompareStrategiesUseCase;

  readonly getPoolHistory: GetPoolHistoryUseCase;

  readonly getPoolTvl: GetPoolTvlUseCase;

  readonly getPoolTvlHistory: GetPoolTvlHistoryUseCase;
}
