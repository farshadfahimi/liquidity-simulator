// app/core/application/use_cases/discover_pools.use_case.ts

import type { TAddress } from '../../shared/types';
import { InvalidUseCaseInputError } from '../errors/invalid_input_error';
import type { IProtocolAdapter } from '../../adapters/protocol_adapter.interface';
import type { TAdapterResolver } from './adapter_resolver.type';

/**
 * Input for {@link DiscoverPoolsUseCase}.
 *
 * `protocolId` is the adapter's `id` field (e.g. `'uniswap-v3'`).
 * The composition root ({@link createCoreServices}) is responsible
 * for resolving this to a concrete {@link IProtocolAdapter}.
 *
 * If omitted, the use case will:
 *   - call `adapter.discoverPools()` against the *first* registered
 *     adapter if exactly one is registered,
 *   - throw {@link InvalidUseCaseInputError} otherwise.
 *
 * Use `tokenA` / `tokenB` / `fee` to look up a specific pool
 * (curated-on-discovery mode).
 */
export interface IDiscoverPoolsInput {
  readonly chainId: number;

  readonly protocolId?: string;

  readonly tokenA?: TAddress;

  readonly tokenB?: TAddress;

  readonly fee?: number;
}

/**
 * Single discovered-pool row. Mirrors `TPoolDiscovery` but flattens
 * the tokens into a minimal `{ address, symbol, decimals }` triple
 * (the `name` field is dropped — UI rarely shows it).
 *
 * For the `lookupPool(tokenA, tokenB, fee)` shortcut, `token0` /
 * `token1` are populated from the input addresses (symbol/decimals
 * default to empty strings / `0`); the caller can enrich them with
 * a subsequent {@link AnalyzePoolUseCase} call.
 */
export interface IDiscoveredPoolDTO {
  readonly pool: TAddress;

  readonly protocolId: string;

  readonly chainId: number;

  readonly token0: IDiscoveredTokenDTO;

  readonly token1: IDiscoveredTokenDTO;

  readonly fee: number;

  readonly tickSpacing?: number;
}

export interface IDiscoveredTokenDTO {
  readonly address: TAddress;

  readonly symbol: string;

  readonly decimals: number;
}

/**
 * Discovery use case: wraps adapter-level pool discovery + the
 * concrete `lookupPool(tokenA, tokenB, fee)` shortcut for V3.
 *
 * Two modes:
 *
 *   - **Discovery** — calls `adapter.discoverPools()` and returns
 *     the curated list. (Currently empty for V3 — see the adapter
 *     docstring. Use `lookupPool` mode instead.)
 *
 *   - **Lookup** — when `tokenA`/`tokenB`/`fee` are supplied, calls
 *     `adapter.resolvePool(...)` (V3-only) and returns a single-row
 *     result. The use case asserts the resolved pool exists.
 */
export class DiscoverPoolsUseCase {
  readonly id = 'discover-pools';

  constructor(private readonly resolveAdapter: TAdapterResolver) {}

  async execute(input: IDiscoverPoolsInput): Promise<readonly IDiscoveredPoolDTO[]> {
    if (input.chainId === undefined || input.chainId === null) {
      throw new InvalidUseCaseInputError(this.id, 'chainId', 'must be a positive integer');
    }

    const adapter = this.resolveAdapter(input.chainId, input.protocolId);

    // Mode 1 — lookup by token pair + fee tier.
    if (input.tokenA && input.tokenB && input.fee !== undefined) {
      // The adapter is duck-typed here: only V3 ships `resolvePool`.
      // Other adapters throw a TypeError-equivalent and we surface
      // it as-is. The use case contract is "ask the adapter; if it
      // can't do it, the adapter decides how to signal that."
      const maybe = (adapter as IProtocolAdapter & {
        resolvePool?: (
          tokenA: TAddress,
          tokenB: TAddress,
          fee: number,
        ) => Promise<TAddress | null>;
      });

      if (typeof maybe.resolvePool !== 'function') {
        throw new InvalidUseCaseInputError(
          this.id,
          'protocolId',
          `adapter '${adapter.id}' does not support lookupPool`,
        );
      }

      const poolAddress = await maybe.resolvePool(input.tokenA, input.tokenB, input.fee);

      if (!poolAddress) {
        // No pool for that triple on this chain. The UI should
        // surface "no pool" gracefully — we return an empty list
        // rather than throwing.
        return [];
      }

      // We don't know fee/tickSpacing here without another round-trip
      // (getPoolState). For the lookup path, the caller usually has
      // the fee tier already — we just echo it back. Symbols /
      // decimals default to empty / 0; the caller can enrich them
      // via a follow-up `AnalyzePoolUseCase` call.
      return [
        {
          pool: poolAddress,
          protocolId: adapter.id,
          chainId: input.chainId,
          token0: { address: input.tokenA, symbol: '', decimals: 0 },
          token1: { address: input.tokenB, symbol: '', decimals: 0 },
          fee: input.fee,
        },
      ];
    }

    // Mode 2 — curated discovery.
    const discovered = await adapter.discoverPools();

    return discovered.map((d) => ({
      pool: d.address,
      protocolId: adapter.id,
      chainId: input.chainId,
      token0: {
        address: d.token0.address,
        symbol: d.token0.symbol,
        decimals: d.token0.decimals,
      },
      token1: {
        address: d.token1.address,
        symbol: d.token1.symbol,
        decimals: d.token1.decimals,
      },
      fee: d.fee,
      tickSpacing: d.tickSpacing,
    }));
  }
}
