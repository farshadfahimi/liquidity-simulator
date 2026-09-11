// app/core/application/use_cases/adapter_resolver.type.ts

import type { IProtocolAdapter } from '../../adapters/protocol_adapter.interface';

/**
 * Adapter-resolution strategy shared by every use case that needs
 * to talk to a protocol adapter.
 *
 * The use case does not own adapter lookup — the composition root
 * ({@link createCoreServices}) injects this so the same use case
 * can be tested without standing up a full adapter registry.
 *
 * Implementations throw {@link AdapterNotFoundError} (from
 * `../errors/adapter_not_found_error`) when no adapter matches
 * the requested chainId / protocolId pair.
 */
export type TAdapterResolver = (
  chainId: number,
  protocolId?: string,
) => IProtocolAdapter;
