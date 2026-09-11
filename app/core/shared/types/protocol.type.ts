// app/core/shared/types/protocol.type.ts

import type { TProtocolId } from './protocol_id.type';
import type { TChainId } from './chain_id.type';

export interface TProtocol {
  id: TProtocolId;

  name: string;

  version: string;

  supportedChains: readonly TChainId[];
}
