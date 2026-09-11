// app/core/shared/types/token.type.ts

import type { TAddress } from './address.type';

export interface TToken {
  address: TAddress;

  symbol: string;

  name: string;

  decimals: number;
}
