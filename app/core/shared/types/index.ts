// app/core/shared/types/index.ts

export type { TAddress } from './address.type';
export type { THex } from './hex.type';
export type { TChainId } from './chain_id.type';
export type { TBlockRange } from './block_range.type';
export type { TProtocolId } from './protocol_id.type';
export type { TNativeCurrency, TNetwork } from './network.type';
export type { TProtocol } from './protocol.type';
export type { TToken } from './token.type';
export type { ITokenSource, TTokenRow } from './token_source.type';

// TVL roadmap (slice 0/2) — market-data shapes.
export type { TTokenPrice } from './token_price.type';
export { POOL_LIQUIDITY_SOURCES } from './pool_liquidity.type';
export type { TPoolLiquidity, TPoolLiquiditySource } from './pool_liquidity.type';
export type { TPoolTvlPoint } from './pool_tvl_point.type';
