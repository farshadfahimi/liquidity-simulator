// app/core/adapters/uniswap/v3/abi/uniswap_v3_pool.abi.ts

/**
 * Minimal ABI fragment for the IUniswapV3Pool contract. Only the
 * functions this adapter actually calls are included. Kept in its own
 * file so it can be reused by multicall batches without duplicating
 * definitions.
 */
export const uniswapV3PoolAbi = [
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
