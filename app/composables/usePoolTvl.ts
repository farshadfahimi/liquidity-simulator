// app/composables/usePoolTvl.ts

/**
 * Thin reactive wrapper around `GetPoolTvlUseCase` — the pool
 * liquidity / TVL card data (TVL-ROADMAP.md slice 3).
 *
 * Per AGENT.md §9.5 a composable is **glue only**: it owns the
 * loading flag, the error string and the last result, and delegates
 * every decision to the application layer. There is no fallback
 * logic here — the use case already implements the full chain
 * (indexed TVL → on-chain estimate → stablecoin anchor → token
 * units) and reports which tier it used in `source`.
 *
 * Always call `useCoreServices()` at the top so SSR stays a no-op:
 * the composition root is installed by the client-only plugin, so
 * `useCases` is `null` during the server pass.
 */

import type { TAddress } from '@core/shared/types';
import type { IPoolTvlDTO } from '@core/application/dtos';

/** Input accepted by {@link usePoolTvl.loadTvl}. */
export interface IUsePoolTvlInput {
  /** The pool to report on. */
  readonly pool: TAddress;

  /** Chain the pool lives on. */
  readonly chainId: number;

  /** Optional protocol id — resolved through the adapter registry. */
  readonly protocolId?: string;

  /** Optional deposit notional in USD at `USD_DECIMALS` (6). */
  readonly notionalUsd?: bigint;
}

/**
 * Reactive TVL state for a single pool.
 *
 * @returns The last DTO, the loading flag, the last error and a
 *   `loadTvl` action (plus `resetTvl` to clear the state when the
 *   route changes).
 */
export function usePoolTvl() {
  const { useCases } = useCoreServices();

  const tvl = ref<IPoolTvlDTO | null>(null);
  const isLoadingTvl = ref(false);
  const lastError = ref<string | null>(null);

  async function loadTvl(input: IUsePoolTvlInput): Promise<IPoolTvlDTO | null> {
    if (!useCases) {
      lastError.value = 'Core services not ready';
      return null;
    }

    isLoadingTvl.value = true;
    lastError.value = null;

    try {
      const { getPoolTvl } = useCases();
      const data = await getPoolTvl.execute(input);
      tvl.value = data;
      return data;
    }
    catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      return null;
    }
    finally {
      isLoadingTvl.value = false;
    }
  }

  function resetTvl(): void {
    tvl.value = null;
    lastError.value = null;
  }

  return {
    // `computed` (not `readonly`) so the exposed type stays exactly
    // `IPoolTvlDTO | null` instead of a deep-readonly mapped type.
    tvl: computed(() => tvl.value),
    isLoadingTvl: readonly(isLoadingTvl),
    lastError: readonly(lastError),
    loadTvl,
    resetTvl,
  };
}
