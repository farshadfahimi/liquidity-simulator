// app/core/adapters/shadow/abi/erc20.abi.ts

/**
 * Re-export of the ERC20 metadata ABI used by Shadow token resolution.
 * Duplicated here (rather than importing from uniswap/v3) so the
 * Shadow adapter is self-contained — each adapter owns its ABI bundle.
 */
export { erc20Abi } from '@core/adapters/uniswap/v3';
