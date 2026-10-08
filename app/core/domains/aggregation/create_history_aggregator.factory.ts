// app/core/domains/aggregation/create_history_aggregator.factory.ts

import { HistoryAggregator } from './history_aggregator.class';

/**
 * Construct a {@link HistoryAggregator}. Pure factory; the class
 * is stateless so a single instance is safe to share across
 * every consumer (charts, simulation pre-processing, SL/TP
 * detection, …).
 *
 * Follows the §5.1 factory convention: a `create*` function,
 * not a class with a singleton pattern.
 */
export function createHistoryAggregator(): HistoryAggregator {
  return new HistoryAggregator();
}
