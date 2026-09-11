// app/core/application/dtos/recommendation.dto.ts

import type { TAddress } from '../../shared/types';

/**
 * Output of {@link CompareStrategiesUseCase}. Wraps the ranked set
 * plus the input knobs the UI passed in. Each `recommendation` is
 * already in DTO form (i.e. plain objects + bigints); the UI can
 * render without touching any Core class.
 *
 * `recommendations` are sorted by `score` descending. Tie-break is
 * deterministic: higher CE wins, then lexicographic on `id`.
 */
export interface IRecommendationDTO {
  readonly pool: TAddress;

  readonly chainId: number;

  readonly protocolId: string;

  readonly poolDescription: string;

  readonly rangeGeneratorId: string;

  readonly strategyIds: readonly string[];

  readonly nCandidates: number;

  readonly nRecommendations: number;

  readonly nSkipped: number;

  readonly recommendations: readonly IRecommendationEntryDTO[];
}

/**
 * One row in the ranked recommendation list. Mirrors the
 * {@link Recommendation} value object's fields verbatim so the UI can
 * rely on a flat shape.
 */
export interface IRecommendationEntryDTO {
  readonly id: string;

  readonly strategyId: string;

  readonly strategyName: string;

  readonly tickLower: number;

  readonly tickUpper: number;

  readonly score: bigint;

  readonly expectedApr: bigint;

  readonly feeRatePerSecond: bigint;

  readonly ilAtCurrentPrice: bigint;

  readonly capitalEfficiency: bigint;

  readonly riskEstimate: bigint;

  readonly currentlyInRange: boolean;

  readonly side: 'below' | 'inside' | 'above';
}
