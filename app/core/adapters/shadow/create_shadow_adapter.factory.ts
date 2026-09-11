// app/core/adapters/shadow/create_shadow_adapter.factory.ts

import type { IRpcProvider } from '@core/providers/rpc';

import { ShadowAdapter } from './shadow_adapter.class';

export interface ICreateShadowAdapterOptions {
  rpc: IRpcProvider;
}

/**
 * Factory function for the Shadow adapter.
 */
export function createShadowAdapter(
  options: ICreateShadowAdapterOptions,
): ShadowAdapter {
  return new ShadowAdapter(options.rpc);
}
