// app/composables/usePoolLookup.ts

import type { TAddress } from '@core/shared/types';

/**
 * Reactive helpers for the "Discover Pools" / "Pool Lookup" UI step
 * in README §UI Flow. Two modes:
 *
 *   - **Lookup by triple** — `lookupPool({ tokenA, tokenB, fee })`
 *     resolves a single pool via the registered Uniswap V3 adapter.
 *
 *   - **Analyze** — `analyzePool(pool)` runs the full
 *     `AnalyzePoolUseCase` for a pool address.
 *
 * Both return reactive refs the page components can `v-if` against
 * without keeping promises in component state.
 */

export function usePoolLookup() {
  const { services, useCases, switchChain, network } = useCoreServices();
  const { option } = useActiveNetwork();
  const toast = useToast();

  const lastError = ref<string | null>(null);
  const isLooking = ref(false);
  const isAnalyzing = ref(false);

  /**
   * Switch the active chain. No-op if the requested chain id is
   * already active.
   */
  function setChain(chainId: number) {
    if (!switchChain) return;
    if (chainId === network?.current().id) return;
    try {
      switchChain(chainId);
      lastError.value = null;
    }
    catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Resolve a single pool by (tokenA, tokenB, fee). Returns
   * `null` when the pool doesn't exist or the chain has no
   * adapter.
   */
  async function lookupPool(input: {
    chainId: number;
    protocolId?: string;
    tokenA: TAddress;
    tokenB: TAddress;
    fee: number;
  }): Promise<{ pool: TAddress; fee: number } | null> {
    if (!useCases) {
      lastError.value = 'Core services not ready';
      return null;
    }
    setChain(input.chainId);
    isLooking.value = true;
    lastError.value = null;

    try {
      const useCase = useCases().discoverPools;
      const rows = await useCase.execute({
        chainId: input.chainId,
        protocolId: input.protocolId,
        tokenA: input.tokenA,
        tokenB: input.tokenB,
        fee: input.fee,
      });
      if (rows.length === 0) {
        lastError.value = `No pool for the supplied triple on chain ${input.chainId} (fee tier ${input.fee / 10000}%).`;
        return null;
      }
      const row = rows[0]!;
      return { pool: row.pool as TAddress, fee: row.fee };
    }
    catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      toast.add({
        title: 'Lookup failed',
        description: lastError.value,
        color: 'error',
      });
      return null;
    }
    finally {
      isLooking.value = false;
    }
  }

  /**
   * Run the analyze-pool use case against a known pool.
   */
  async function analyzePool(input: {
    chainId: number;
    pool: TAddress;
    protocolId?: string;
  }) {
    if (!useCases) {
      lastError.value = 'Core services not ready';
      return null;
    }
    setChain(input.chainId);
    isAnalyzing.value = true;
    lastError.value = null;

    try {
      const useCase = useCases().analyzePool;
      return await useCase.execute({
        pool: input.pool,
        chainId: input.chainId,
        protocolId: input.protocolId,
      });
    }
    catch (err) {
      // AdapterNotFoundError → surface "no adapter for chain"
      const message = err instanceof Error ? err.message : String(err);
      lastError.value = message;
      toast.add({ title: 'Analysis failed', description: message, color: 'error' });
      return null;
    }
    finally {
      isAnalyzing.value = false;
    }
  }

  return {
    option,
    network,
    services,
    lastError: readonly(lastError),
    isLooking: readonly(isLooking),
    isAnalyzing: readonly(isAnalyzing),
    setChain,
    lookupPool,
    analyzePool,
  };
}
