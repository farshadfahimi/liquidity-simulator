// app/core/domains/recommendation/create_recommendation_engine.factory.ts

import { RecommendationEngine } from './recommendation_engine.class';

/**
 * Construct a new {@link RecommendationEngine} — stateless, so the
 * factory is a thin wrapper kept for symmetry with other domain
 * factories.
 */
export function createRecommendationEngine(): RecommendationEngine {
  return new RecommendationEngine();
}