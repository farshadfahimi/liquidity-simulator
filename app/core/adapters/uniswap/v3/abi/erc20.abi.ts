// app/core/adapters/uniswap/v3/abi/erc20.abi.ts

/**
 * Minimal ERC20 ABI for fetching token metadata. The adapter never
 * performs transfers or approvals — only `symbol`, `name`, `decimals`.
 */
export const erc20Abi = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'symbol',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'name',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;
