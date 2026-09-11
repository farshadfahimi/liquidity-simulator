// app/core/providers/rpc/rpc_provider.interface.ts

import type { TAddress } from '@core/shared/types';
import type { THex } from '@core/shared/types';
import type { TBlockRange } from '@core/shared/types';

/**
 * Generic, viem-agnostic RPC provider. The only place that knows how to
 * talk to a node. Concrete implementation wraps viem's PublicClient.
 */
export interface IRpcProvider {
  readonly chainId: number;

  /**
   * Read a single contract slot/function. `args` are passed as a tuple to
   * the underlying `eth_call`. Pass `blockTag` to pin the call to a
   * historical block (Phase 7).
   */
  readContract<TReturn = unknown>(
    params: TReadContractParams,
  ): Promise<TReturn>;

  /**
   * Batch multiple readContract calls in a single multicall round-trip.
   * When `blockTag` is set on individual calls, viem honours it
   * (Phase 7).
   */
  multicall<TReturn = unknown>(
    calls: readonly TMulticallCall<TReturn>[],
  ): Promise<readonly TReturn[]>;

  /**
   * Block info by number. `tag` may be 'latest' | 'earliest' | 'pending'
   * | 'finalized' | 'safe' | 'latest' | bigint.
   */
  getBlock(
    tag: TBlockTag,
  ): Promise<TBlock>;

  /**
   * Latest block number.
   */
  getBlockNumber(): Promise<bigint>;

  /**
   * Get logs emitted by `address` (or all, if undefined) between
   * `fromBlock` and `toBlock`.
   */
  getLogs(
    filter: TLogFilter,
  ): Promise<readonly TLog[]>;

  /**
   * Transaction receipt by hash.
   */
  getTransactionReceipt(
    hash: THex,
  ): Promise<TTransactionReceipt | null>;

  /**
   * Bytecode at an address. Returns '0x' for EOAs.
   */
  getCode(
    address: TAddress,
  ): Promise<THex>;

  /**
   * Native currency balance of an address.
   */
  getBalance(
    address: TAddress,
  ): Promise<bigint>;
}

export type TBlockTag =
  | 'latest'
  | 'earliest'
  | 'pending'
  | 'finalized'
  | 'safe'
  | bigint;

export interface TReadContractParams {
  address: TAddress;

  abi: readonly unknown[];

  functionName: string;

  args?: readonly unknown[];

  /**
   * Optional historical block tag (Phase 7). When supplied, the
   * `readContract` call is pinned to that block instead of 'latest'.
   * Public RPCs that don't expose archive state will reject blocks
   * older than their retention window — use a paid archive RPC for
   * truly historical reads.
   *
   * Defaults to undefined (latest). Pass a `bigint` block number
   * to pin to a specific block.
   */
  readonly blockTag?: bigint;
}

export interface TMulticallCall<TReturn> {
  address: TAddress;

  abi: readonly unknown[];

  functionName: string;

  args?: readonly unknown[];

  /**
   * Optional historical block tag (Phase 7). Same semantics as
   * {@link TReadContractParams.blockTag}. When supplied, all
   * calls in the multicall batch are pinned to the same block.
   */
  readonly blockTag?: bigint;
}

export interface TLogFilter {
  address?: TAddress | readonly TAddress[];

  topics?: readonly (THex | readonly THex[] | null)[];

  fromBlock: bigint;

  toBlock: bigint;

  /**
   * Optional override for the block tag the call is pinned to
   * (Phase 7). When supplied, viem uses this tag instead of the
   * default. The vast majority of callers leave this undefined.
   */
  readonly blockTag?: bigint;
}

export interface TBlock {
  number: bigint;

  hash: THex;

  timestamp: bigint;

  parentHash: THex;

  baseFeePerGas?: bigint;
}

export interface TLog {
  address: TAddress;

  blockNumber: bigint;

  transactionHash: THex;

  logIndex: number;

  topics: readonly THex[];

  data: THex;
}

export interface TTransactionReceipt {
  transactionHash: THex;

  blockNumber: bigint;

  status: 'success' | 'reverted';

  gasUsed: bigint;

  logs: readonly TLog[];
}
