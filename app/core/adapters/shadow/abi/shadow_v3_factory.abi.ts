// app/core/adapters/shadow/abi/shadow_v3_factory.abi.ts

/**
 * ABI fragment for the Shadow CL Factory. Same surface as Uniswap V3 —
 * `getPool(tokenA, tokenB, fee)`.
 */
export const shadowV3FactoryAbi = [
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
