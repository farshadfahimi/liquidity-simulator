// app/core/application/use_cases/analyze_pool.use_case.ts

import type { TAddress } from '../../shared/types';
import { Pool } from '../../domains/pool';
import type { PoolHistory } from '../../domains/history';
import { AnalyticsEngine } from '../../domains/analytics';
import { InvalidUseCaseInputError } from '../errors/invalid_input_error';
import type { IPoolAnalysisDTO, ITokenSummaryDTO } from '../dtos/pool_analysis.dto';
import type { IProtocolAdapter } from '../../adapters/protocol_adapter.interface';
import type { TAdapterResolver } from './adapter_resolver.type';

/**
 * Input for {@link AnalyzePoolUseCase}.
 *
 * `history` is optional. When supplied, the use case derives
 * realized volatility + history-window stats. When omitted, those
 * fields default to `0n` and the use case still returns a valid
 * DTO — the UI should show "no history" instead of "no data".
 *
 * `priceDecimals` controls the precision of `currentPrice` in the
 * returned DTO (default 18).
 */
export interface IAnalyzePoolInput {
  readonly pool: TAddress;

  readonly chainId: number;

  readonly protocolId?: string;

  readonly history?: PoolHistory;

  readonly priceDecimals?: number;
}

/**
 * Analyze-pool use case: fetch the live pool state, optionally
 * compute analytics from a snapshot history, return a
 * protocol-neutral DTO the UI can render directly.
 *
 * This use case is the "single pool summary" — it powers the pool
 * detail card and is the prerequisite for every downstream use
 * case (SimulatePosition, CompareStrategies, ...).
 */
export class AnalyzePoolUseCase {
  readonly id = 'analyze-pool';

  constructor(
    private readonly resolveAdapter: TAdapterResolver,
    private readonly analytics: AnalyticsEngine = new AnalyticsEngine(),
  ) {}

  async execute(input: IAnalyzePoolInput): Promise<IPoolAnalysisDTO> {
    if (!input.pool) {
      throw new InvalidUseCaseInputError(this.id, 'pool', 'address is required');
    }

    if (input.chainId === undefined || input.chainId === null) {
      throw new InvalidUseCaseInputError(this.id, 'chainId', 'must be a positive integer');
    }

    const adapter = this.resolveAdapter(input.chainId, input.protocolId);
    const state = await adapter.getPoolState(input.pool);

    // We don't load ticks here — they're expensive and not needed
    // for the high-level summary. Callers wanting ticks should use
    // `adapter.getTicks` directly.

    const pool = new Pool(state, input.chainId);
    const priceDecimals = input.priceDecimals ?? 18;
    const currentPrice = pool.currentPrice(priceDecimals);

    let annualizedVolatility = 0n;
    let cumulativeReturn = 10n ** 18n; // 1.0 — neutral default
    let snapshotCount = 0;
    let historyWindowSeconds = 0n;

    if (input.history && input.history.size() >= 2) {
      const vol = this.analytics.volatilityFromHistory(input.history);
      annualizedVolatility = vol?.volAnnual ?? 0n;
      snapshotCount = input.history.size();
      const first = input.history.earliest();
      const last = input.history.latest();

      if (first && last) {
        historyWindowSeconds = last.timestamp - first.timestamp;
        // `last.price.ratio(first.price, 18)` → 1e18 == 1.0.
        cumulativeReturn = last.price.ratio(first.price, 18).value;
      }
    }

    const token0: ITokenSummaryDTO = {
      address: state.token0.address,
      symbol: state.token0.symbol,
      decimals: state.token0.decimals,
    };
    const token1: ITokenSummaryDTO = {
      address: state.token1.address,
      symbol: state.token1.symbol,
      decimals: state.token1.decimals,
    };

    return {
      pool: input.pool,
      chainId: input.chainId,
      protocolId: adapter.id,
      description: pool.describe(),
      feeTier: state.fee,
      tickSpacing: state.tickSpacing,
      currentTick: state.tick,
      currentPrice: currentPrice.value,
      currentPriceDecimals: priceDecimals,
      token0,
      token1,
      annualizedVolatility,
      cumulativeReturn,
      returnDecimals: 18,
      snapshotCount,
      historyWindowSeconds,
    };
  }
}
