// app/core/shared/errors/unknown_network.error.ts

import type { TChainId } from '../types';

export class UnknownNetworkError extends Error {
  constructor(chainId: TChainId) {
    super(`Unknown network for chainId: ${chainId}`);

    this.name = 'UnknownNetworkError';
  }
}
