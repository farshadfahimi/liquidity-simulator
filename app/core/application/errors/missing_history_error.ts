// app/core/application/errors/missing_history_error.ts

import type { TAddress } from '../../shared/types';
import { UseCaseError } from './use_case_error';

/**
 * Thrown when a use case requires pool history (e.g. to compute
 * realized volatility or run a historical-replay simulation) but no
 * history provider / pool history is available.
 *
 * The caller should either fetch history via the {@link IHistoryProvider}
 * first, or fall back to a use case that doesn't need history
 * (e.g. {@link AnalyzePoolUseCase} can run without history and just
 * emit `σ = 0`).
 */
export class MissingPoolHistoryError extends UseCaseError {
  readonly code = 'missing-pool-history';

  constructor(
    public readonly useCase: string,
    public readonly pool: TAddress,
    public readonly chainId: number,
  ) {
    super(
      `[${useCase}] pool ${pool} on chain ${chainId} has no history — `
      + `fetch a history first via IHistoryProvider.replayBlocks/replayLogs`,
    );
  }
}
