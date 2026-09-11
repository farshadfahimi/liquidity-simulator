// app/core/adapters/shadow/abi/shadow_v3_pool.abi.ts

/**
 * Minimal ABI fragment for the Shadow CL Pool. Shadow's pool contract is
 * V3-compatible at the storage layout level — the function signatures
 * and slot encodings match Uniswap V3 — so we reuse the same shape.
 */
export const shadowV3PoolAbi = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'slot0',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'liquidity',
    inputs: [],
    outputs: [{ name: '', type: 'uint128' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'feeGrowthGlobal0X128',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'feeGrowthGlobal1X128',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'ticks',
    inputs: [{ name: 'tick', type: 'int24' }],
    outputs: [
      { name: 'liquidityGross', type: 'uint128' },
      { name: 'liquidityNet', type: 'int128' },
    ],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'token0',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'token1',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'fee',
    inputs: [],
    outputs: [{ name: '', type: 'uint24' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'tickSpacing',
    inputs: [],
    outputs: [{ name: '', type: 'int24' }],
  },
] as const;
