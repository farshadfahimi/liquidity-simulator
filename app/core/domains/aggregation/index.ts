// app/core/domains/aggregation/index.ts

export type { TCandleTimeframe } from './candle_timeframe.type';
export { ALL_TIMEFRAMES, TIMEFRAME_SECONDS, isCandleTimeframe } from './candle_timeframe.type';

export { OhlcCandle } from './ohlc_candle.value-object';

export type { IAggregatableSnapshot } from './history_aggregator.class';
export { HistoryAggregator } from './history_aggregator.class';

export { createHistoryAggregator } from './create_history_aggregator.factory';
