// app/core/application/errors/adapter_not_found_error.ts

import { UseCaseError } from './use_case_error';

/**
 * Thrown when a use case needs a protocol adapter (e.g. to call
 * `adapter.getPoolState(...)` or `adapter.quotePosition(...)`) but
 * no adapter is registered for the requested chain.
 *
 * The composition root ({@link createCoreServices}) decides which
 * adapter covers which chain. This error signals that the requested
 * chain isn't covered by any registered adapter.
 */
export class AdapterNotFoundError extends UseCaseError {
  readonly code = 'adapter-not-found';

  constructor(
    public readonly useCase: string,
    public readonly chainId: number,
    public readonly protocolId?: string,
  ) {
    const proto = protocolId ? ` (protocol=${protocolId})` : '';

    super(`[${useCase}] no adapter registered for chainId=${chainId}${proto}`);
  }
}
