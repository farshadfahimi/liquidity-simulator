// app/core/adapters/uniswap/v3/abi/uniswap_v3_factory.abi.ts

/**
 * ABI fragment for the Uniswap V3 Factory contract. Only `getPool` is
 * required for on-demand pool discovery by (token0, token1, fee); the
 * rest are reserved for future enumeration work.
 */
export const uniswapV3FactoryAbi = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getPool',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
] as const;
