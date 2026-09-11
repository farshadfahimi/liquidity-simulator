// app/core/shared/errors/no_adapter_for_chain.error.ts

import type { TChainId } from '../types';

export class NoAdapterForChainError extends Error {
  constructor(chainId: TChainId) {
    super(`No protocol adapter registered for chainId: ${chainId}`);

    this.name = 'NoAdapterForChainError';
  }
}
