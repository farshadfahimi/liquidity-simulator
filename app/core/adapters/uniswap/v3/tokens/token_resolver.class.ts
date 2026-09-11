// app/core/adapters/uniswap/v3/tokens/token_resolver.class.ts

import type { IRpcProvider } from '@core/providers/rpc';

import { erc20Abi } from '../abi/erc20.abi';
import type { TAddress } from '@core/shared/types';
import type { TToken } from '@core/shared/types';

/**
 * Resolves ERC20 metadata (symbol, name, decimals) for a token address
 * via batched multicall reads. Stateless and safe to share across pools.
 */
export class UniswapV3TokenResolver {
  constructor(private readonly rpc: IRpcProvider) {}

  async resolveMany(
    addresses: readonly TAddress[],
  ): Promise<readonly TToken[]> {
    const calls = addresses.flatMap((address) => [
      {
        address,
        abi: erc20Abi,
        functionName: 'symbol',
      },
      {
        address,
        abi: erc20Abi,
        functionName: 'name',
      },
      {
        address,
        abi: erc20Abi,
        functionName: 'decimals',
      },
    ]);

    const results = await this.rpc.multicall<string | number>(calls);

    const tokens: TToken[] = [];
    for (let i = 0; i < addresses.length; i += 1) {
      const symbol = String(results[i * 3] ?? '');
      const name = String(results[i * 3 + 1] ?? '');
      const decimals = Number(results[i * 3 + 2] ?? 18);

      tokens.push({
        address: addresses[i]!,
        symbol,
        name,
        decimals,
      });
    }

    return tokens;
  }

  async resolve(address: TAddress): Promise<TToken> {
    const [token] = await this.resolveMany([address]);
    if (!token) {
      throw new Error(
        `UniswapV3TokenResolver: failed to resolve token ${address}`,
      );
    }
    return token;
  }
}
