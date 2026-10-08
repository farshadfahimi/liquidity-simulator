// app/core/test/_fixtures/stub_rpc_provider.ts
//
// In-memory IRpcProvider stub for unit tests. Serves a
// caller-supplied block table from a Map; every other method
// throws so a test that accidentally leans on real RPC
// behaviour surfaces immediately. The shape of the contract
// methods (`readContract`, `multicall`) is intentionally
// minimal — they exist so the stub *type-checks* as
// `IRpcProvider`, not because the use cases under test need
// them. The history use case only touches `getBlockNumber`
// and `getBlock`, so those are the only fully-implemented
// methods. Anything else (`getLogs`, `getCode`, `getBalance`,
// `getTransactionReceipt`) throws on purpose.

import type {
  IRpcProvider,
  TBlock,
  TBlockTag,
  TLog,
  TLogFilter,
  TMulticallCall,
  TReadContractParams,
  TTransactionReceipt,
} from '@core/providers/rpc';
import type { TAddress, THex } from '@core/shared/types';

/** Minimal block record the stub needs to serve. */
export interface IStubBlock {
  readonly number: bigint;
  readonly timestamp: bigint;
  /** Optional parent hash; defaults to a synthetic zero hash. */
  readonly parentHash?: THex;
  /** Optional block hash; defaults to a synthetic hash derived from the number. */
  readonly hash?: THex;
}

export interface IStubRpcOptions {
  /** Blocks served by `getBlock(N)`. The maximum block number is
   * also the "latest" the stub reports to `getBlockNumber()`. */
  readonly blocks: readonly IStubBlock[];

  /**
   * Block number to report from `getBlockNumber()`. When
   * omitted, defaults to the maximum block number in `blocks`.
   * Set this to a value larger than any historical block to
   * force the use case to walk the block range it asked for.
   */
  readonly latestBlock?: bigint;
}

const ZERO_HASH = '0x' + '0'.repeat(64) as THex;
const syntheticHash = (n: bigint): THex =>
  ('0x' + n.toString(16).padStart(64, '0')) as THex;

/**
 * Build a `IRpcProvider` that serves `getBlockNumber` /
 * `getBlock` from the supplied block table and throws for
 * everything else. The history use case only ever asks for
 * these two methods, so a "throws on readContract" stub is
 * the smallest useful surface and prevents silent test
 * corruption.
 */
export function createStubRpcProvider(
  options: IStubRpcOptions,
): IRpcProvider {
  const blocks = new Map<bigint, TBlock>();
  for (const b of options.blocks) {
    blocks.set(b.number, {
      number: b.number,
      timestamp: b.timestamp,
      hash: b.hash ?? syntheticHash(b.number),
      parentHash: b.parentHash ?? ZERO_HASH,
    });
  }
  const latest = options.latestBlock
    ?? (blocks.size > 0
      ? [...blocks.keys()].reduce((a, b) => (a > b ? a : b))
      : 0n);

  return {
    chainId: 1,

    async getBlockNumber(): Promise<bigint> {
      return latest;
    },

    async getBlock(tag: TBlockTag): Promise<TBlock> {
      if (tag === 'latest' || tag === 'pending' || tag === 'finalized' || tag === 'safe') {
        const block = blocks.get(latest);
        if (!block) {
          throw new Error(`StubRpcProvider: no "latest" block registered (latest=${latest})`);
        }
        return block;
      }
      if (tag === 'earliest') {
        const earliest = [...blocks.keys()].reduce((a, b) => (a < b ? a : b));
        const block = blocks.get(earliest);
        if (!block) {
          throw new Error('StubRpcProvider: no "earliest" block registered');
        }
        return block;
      }
      const block = blocks.get(tag);
      if (!block) {
        throw new Error(
          `StubRpcProvider: no block registered for number ${tag} ` +
          `(have: ${[...blocks.keys()].map((n) => n.toString()).join(', ')})`,
        );
      }
      return block;
    },

    async readContract<TReturn = unknown>(
      _params: TReadContractParams,
    ): Promise<TReturn> {
      throw new Error(
        'StubRpcProvider: readContract is not implemented — ' +
        'history use case should only touch getBlockNumber / getBlock',
      );
    },

    async multicall<TReturn = unknown>(
      _calls: readonly TMulticallCall<TReturn>[],
    ): Promise<readonly TReturn[]> {
      throw new Error(
        'StubRpcProvider: multicall is not implemented — ' +
        'history use case should only touch getBlockNumber / getBlock',
      );
    },

    async getLogs(_filter: TLogFilter): Promise<readonly TLog[]> {
      throw new Error('StubRpcProvider: getLogs is not implemented');
    },

    async getTransactionReceipt(
      _hash: THex,
    ): Promise<TTransactionReceipt | null> {
      throw new Error('StubRpcProvider: getTransactionReceipt is not implemented');
    },

    async getCode(_address: TAddress): Promise<THex> {
      throw new Error('StubRpcProvider: getCode is not implemented');
    },

    async getBalance(_address: TAddress): Promise<bigint> {
      throw new Error('StubRpcProvider: getBalance is not implemented');
    },
  };
}
