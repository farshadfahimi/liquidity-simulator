// app/core/network/network_provider.interface.ts

import type { IRpcProvider } from '@core/providers/rpc';
import type { TChainId } from '@core/shared/types';
import type { TNetwork } from '@core/shared/types';

/**
 * Holds the "currently selected" network and lazily builds an IRpcProvider
 * for it. The UI uses this to model a network switcher.
 */
export interface INetworkProvider {
  current(): TNetwork;

  rpc(): IRpcProvider;

  switch(chainId: TChainId): TNetwork;
}
