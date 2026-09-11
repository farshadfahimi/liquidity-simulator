// app/core/shared/errors/rpc_call.error.ts

export class RpcCallError extends Error {
  constructor(
    public readonly method: string,
    public readonly cause: unknown,
  ) {
    super(`RPC call "${method}" failed: ${String(cause)}`);

    this.name = 'RpcCallError';
  }
}
