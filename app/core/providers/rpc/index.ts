// app/core/providers/rpc/index.ts

export type { IRpcProvider } from './rpc_provider.interface';
export type {
  TBlock,
  TBlockTag,
  TLog,
  TLogFilter,
  TMulticallCall,
  TReadContractParams,
  TTransactionReceipt,
} from './rpc_provider.interface';
export { RpcProvider } from './rpc_provider.class';
export { createRpcProvider } from './create_rpc_provider.factory';
export type { ICreateRpcProviderOptions } from './create_rpc_provider.factory';

// Phase 11 — access-key presets. Used by the UI's RPC settings
// drawer to translate (preset, key) → (url, headers). The Core
// itself doesn't care about presets; it's just plumbing so the
// UI doesn't have to encode the auth shape per provider.
export {
  RPC_PROVIDER_PRESETS,
  buildPresetHeaders,
  buildPresetUrl,
  chainSlug,
  findPreset,
} from './provider_presets';
export type {
  IRpcProviderPreset,
  TPresetMode,
} from './provider_presets';
