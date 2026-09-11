// app/core/providers/rpc/rpc_provider.class.ts

import {
  createPublicClient,
  fallback,
  http,
  type Chain,
  type PublicClient,
} from 'viem';

import type {
  IRpcProvider,
  TBlock,
  TBlockTag,
  TLog,
  TLogFilter,
  TMulticallCall,
  TReadContractParams,
  TTransactionReceipt,
} from './rpc_provider.interface';
import type { TAddress } from '@core/shared/types';
import type { THex } from '@core/shared/types';

/**
 * Concrete IRpcProvider backed by viem's PublicClient. The ONLY place in
 * the Core that imports viem.
 *
 * Phase 9 — wraps the chain's RPC list in viem's `fallback`
 * transport so transport-level failures (CORS, 5xx, timeout) on
 * one endpoint transparently try the next. See AGENT.md §6.17.
 */
export class RpcProvider implements IRpcProvider {
  readonly chainId: number;

  private readonly client: PublicClient;

  constructor(opts: { chain: Chain; rpcUrls: readonly string[] }) {
    this.chainId = opts.chain.id;

    // viem's `fallback` transport accepts an array of transports
    // and rotates through them on failure. With a single URL it
    // behaves identically to `http(url)`.
    const transports = opts.rpcUrls.map((url) => http(url));

    this.client = createPublicClient({
      chain: opts.chain,
      transport: fallback(transports),
    }) as PublicClient;
  }

  async readContract<TReturn = unknown>(
    params: TReadContractParams,
  ): Promise<TReturn> {
    const result = await this.client.readContract({
      address: params.address,
      abi: params.abi as readonly Record<string, unknown>[],
      functionName: params.functionName,
      args: params.args as readonly unknown[] | undefined,
      // Phase 7 — pin to a historical block when requested.
      ...(params.blockTag !== undefined ? { blockNumber: params.blockTag } : {}),
    });

    return result as TReturn;
  }

  async multicall<TReturn = unknown>(
    calls: readonly TMulticallCall<TReturn>[],
  ): Promise<readonly TReturn[]> {
    const contracts = calls.map((c) => ({
      address: c.address,
      abi: c.abi as readonly Record<string, unknown>[],
      functionName: c.functionName,
      args: c.args as readonly unknown[] | undefined,
      // Phase 7 — per-call block pin. Viem's `multicall` accepts
      // `blockNumber` per contract.
      ...(c.blockTag !== undefined ? { blockNumber: c.blockTag } : {}),
    }));

    const results = await this.client.multicall({ contracts });

    return results.map((r) => {
      if (r.status !== 'success') {
        throw new Error(`multicall sub-call failed: ${r.error}`);
      }

      return r.result as TReturn;
    });
  }

  async getBlock(tag: TBlockTag): Promise<TBlock> {
    // viem 2.55+ has split `getBlock` parameters: `blockNumber`
    // (bigint) and `blockTag` (string). Passing a bigint to
    // `blockTag` sends the unprefixed decimal string and the RPC
    // rejects it as "hex string without 0x prefix". Forward the
    // bigint to the right field.
    const params = typeof tag === 'bigint'
      ? { blockNumber: tag }
      : { blockTag: tag };
    const block = await this.client.getBlock(params);

    return {
      number: block.number ?? 0n,
      hash: block.hash ?? '0x',
      timestamp: block.timestamp,
      parentHash: block.parentHash,
      baseFeePerGas: block.baseFeePerGas ?? undefined,
    };
  }

  async getBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async getLogs(filter: TLogFilter): Promise<readonly TLog[]> {
    const logs = await this.client.getLogs({
      address: filter.address as TAddress | TAddress[] | undefined,
      topics: filter.topics as
        | readonly (THex | readonly THex[] | null)[]
        | undefined,
      fromBlock: filter.fromBlock,
      toBlock: filter.toBlock,
      // Phase 7 — viem's getLogs doesn't have a single `blockNumber`
      // override (logs are inherently block-range-scoped), so
      // `blockTag` on the filter is accepted but ignored for now.
      // Documented in the interface as "optional override".
      ...(filter.blockTag !== undefined ? { blockNumber: filter.blockTag } : {}),
    });

    return logs.map((l) => ({
      address: l.address,
      blockNumber: l.blockNumber ?? 0n,
      transactionHash: l.transactionHash ?? '0x',
      logIndex: Number(l.logIndex ?? 0),
      topics: l.topics as readonly THex[],
      data: l.data,
    }));
  }

  async getTransactionReceipt(
    hash: THex,
  ): Promise<TTransactionReceipt | null> {
    const r = await this.client.getTransactionReceipt({ hash });

    if (!r) {
      return null;
    }

    return {
      transactionHash: r.transactionHash,
      blockNumber: r.blockNumber,
      status: r.status,
      gasUsed: r.gasUsed,
      logs: r.logs.map((l) => ({
        address: l.address,
        blockNumber: l.blockNumber ?? 0n,
        transactionHash: l.transactionHash ?? '0x',
        logIndex: Number(l.logIndex ?? 0),
        topics: l.topics as readonly THex[],
        data: l.data,
      })),
    };
  }

  async getCode(address: TAddress): Promise<THex> {
    return this.client.getBytecode({ address });
  }

  async getBalance(address: TAddress): Promise<bigint> {
    return this.client.getBalance({ address });
  }
}
