// app/core/adapters/shadow/addresses/shadow_v3_factory_addresses.const.ts

import { sonic } from 'viem/chains';

import type { TAddress } from '@core/shared/types';
import type { TChainId } from '@core/shared/types';

/**
 * Canonical Shadow CL Factory deployments per chain. Shadow is currently
 * only deployed on Sonic mainnet. Address is lowercase to avoid EIP-55
 * checksum validation surprises (viem enforces mixed-case checksums).
 *
 * TODO: Verify this address against the Shadow docs / Sonic explorer
 * before relying on it for production reads. The current value is a
 * placeholder; concrete factory calls against this address will fail
 * until the canonical deployment is confirmed.
 */
export const shadowV3FactoryAddresses: Readonly<Record<TChainId, TAddress>> = {
  [sonic.id]: '0x2da0d4694d916126dae6f2db66f8e0fd34d014c2',
};
