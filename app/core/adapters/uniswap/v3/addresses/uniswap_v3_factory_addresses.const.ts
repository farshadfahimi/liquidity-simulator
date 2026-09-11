// app/core/adapters/uniswap/v3/addresses/uniswap_v3_factory_addresses.const.ts

import { mainnet } from 'viem/chains';
import { arbitrum } from 'viem/chains';
import { base } from 'viem/chains';

import type { TAddress } from '@core/shared/types';
import type { TChainId } from '@core/shared/types';

/**
 * Canonical Uniswap V3 Factory deployments per chain. The adapter uses
 * this map to resolve which factory address to read `getPool` from when
 * the active network is known.
 */
export const uniswapV3FactoryAddresses: Readonly<Record<TChainId, TAddress>> =
  {
    [mainnet.id]: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    [arbitrum.id]: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    [base.id]: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  };
