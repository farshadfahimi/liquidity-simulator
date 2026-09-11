// app/core/domains/analytics/create_analytics_engine.factory.ts

import { AnalyticsEngine } from './analytics_engine.class';

/**
 * Construct a new {@link AnalyticsEngine} — stateless, so the factory
 * is a thin wrapper kept for symmetry with other domain factories.
 */
export function createAnalyticsEngine(): AnalyticsEngine {
  return new AnalyticsEngine();
}
