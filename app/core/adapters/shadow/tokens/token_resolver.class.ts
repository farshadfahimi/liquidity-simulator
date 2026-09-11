// app/core/adapters/shadow/tokens/token_resolver.class.ts

import type { IRpcProvider } from '@core/providers/rpc';

import { erc20Abi } from '../abi/erc20.abi';
import type { TAddress } from '@core/shared/types';
import type { TToken } from '@core/shared/types';

/**
 * Resolves ERC20 metadata for Shadow tokens via batched multicall
 * reads. Mirrors the Uniswap V3 token resolver; kept per-adapter so the
 * dependency graph stays one-directional.
 */
export class ShadowTokenResolver {
  constructor(private readonly rpc: IRpcProvider) {}

  async resolveMany(
    addresses: readonly TAddress[],
  ): Promise<readonly TToken[]> {
    const calls = addresses.flatMap((address) => [
      { address, abi: erc20Abi, functionName: 'symbol' },
      { address, abi: erc20Abi, functionName: 'name' },
      { address, abi: erc20Abi, functionName: 'decimals' },
    ]);

    const results = await this.rpc.multicall<string | number>(calls);

    const tokens: TToken[] = [];
    for (let i = 0; i < addresses.length; i += 1) {
      tokens.push({
        address: addresses[i]!,
        symbol: String(results[i * 3] ?? ''),
        name: String(results[i * 3 + 1] ?? ''),
        decimals: Number(results[i * 3 + 2] ?? 18),
      });
    }
    return tokens;
  }

  async resolve(address: TAddress): Promise<TToken> {
    const [token] = await this.resolveMany([address]);
    if (!token) {
      throw new Error(
        `ShadowTokenResolver: failed to resolve token ${address}`,
      );
    }
    return token;
  }
}
