// app/core/adapters/uniswap/v3/create_uniswap_v3_adapter.factory.ts

import type { IRpcProvider } from '@core/providers/rpc';

import { UniswapV3Adapter } from './uniswap_v3_adapter.class';

export interface ICreateUniswapV3AdapterOptions {
  rpc: IRpcProvider;
}

/**
 * Factory function for the Uniswap V3 adapter. Kept as a free function
 * (rather than a class) to align with the rest of Core's factory style.
 */
export function createUniswapV3Adapter(
  options: ICreateUniswapV3AdapterOptions,
): UniswapV3Adapter {
  return new UniswapV3Adapter(options.rpc);
}
