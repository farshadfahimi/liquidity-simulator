// app/core/test/providers/rpc_provider_headers.test.ts

/**
 * Phase 11 — access-key slice. Verifies the `RpcProvider`
 * constructor + `createRpcProvider` factory thread the optional
 * `rpcHeaders` map down to viem's `http()` transport as
 * `fetchOptions.headers`, without breaking the no-header default
 * path used by every test fixture that builds an RPC against a
 * public endpoint.
 *
 * We don't actually open a socket here — viem's `http()`
 * transport happily builds even with unreachable URLs, and the
 * `fetchOptions` we pass through are stored on the transport's
 * config. We inspect them by re-reading the transport's `config`
 * field. (viem doesn't expose a public getter for `fetchOptions`
 * today, so we reach into the same `.config` field it uses
 * internally; the cast is contained to this test.)
 */

import { mainnet } from 'viem/chains';

import { describe, expect, it } from 'vitest';

import { RpcProvider, createRpcProvider } from '@core/providers/rpc';

/**
 * After `createPublicClient({ transport: fallback([http(...)...]) })`,
 * the resulting `client.transport` has shape:
 *
 *   {
 *     config: { type: 'fallback', ... },
 *     request: ...,
 *     onResponse: ...,
 *     transports: [
 *       { config: { type: 'http', ... },
 *         value:  { url, fetchOptions?: { headers? } } },
 *       ...
 *     ]
 *   }
 *
 * (Notably, `client.transport` itself has no `.value` — that's
 * only present when the transport factory is called *as a
 * function* outside the client wrapper. See viem's
 * `createTransport` for the contract.)
 *
 * We peek into `client.transport.transports[i].value.fetchOptions.headers`
 * (viem-internal) to assert our headers reach every underlying
 * transport. The `as unknown as` casts are contained to this
 * helper; the public API only exposes the chainId.
 */
interface IFallbackTransportInternal {
  transports?: ReadonlyArray<{
    value?: {
      url?: string;
      fetchOptions?: { headers?: Record<string, string> };
    };
  }>;
}

function innerTransports(rpc: RpcProvider) {
  const client = (rpc as unknown as {
    client: { transport: IFallbackTransportInternal };
  }).client;
  return client.transport.transports ?? [];
}

function headersOf(rpc: RpcProvider, index = 0): Record<string, string> | undefined {
  return innerTransports(rpc)[index]?.value?.fetchOptions?.headers;
}

function urlOf(rpc: RpcProvider, index = 0): string | undefined {
  return innerTransports(rpc)[index]?.value?.url;
}

describe('RpcProvider — header passthrough (Phase 11)', () => {
  it('createRpcProvider attaches headers to every transport in the fallback list', () => {
    const headers = { 'x-api-key': 'secret' };
    const rpc = createRpcProvider({
      chain: mainnet,
      rpcUrls: ['https://example.com/a', 'https://example.com/b'],
      rpcHeaders: headers,
    });

    expect(innerTransports(rpc).length).toBe(2);
    expect(headersOf(rpc, 0)).toEqual(headers);
    expect(headersOf(rpc, 1)).toEqual(headers);
    expect(urlOf(rpc, 0)).toBe('https://example.com/a');
    expect(urlOf(rpc, 1)).toBe('https://example.com/b');
  });

  it('omits fetchOptions.headers when rpcHeaders is undefined (default)', () => {
    const rpc = createRpcProvider({
      chain: mainnet,
      rpcUrls: ['https://example.com'],
    });

    expect(innerTransports(rpc).length).toBe(1);
    expect(headersOf(rpc)).toBeUndefined();
    expect(urlOf(rpc)).toBe('https://example.com');
  });

  it('RpcProvider constructor attaches headers to every transport', () => {
    const headers = { 'x-api-key': 'secret-key' };
    const rpc = new RpcProvider({
      chain: mainnet,
      rpcUrls: ['https://example.com'],
      rpcHeaders: headers,
    });

    expect(innerTransports(rpc).length).toBe(1);
    expect(headersOf(rpc)).toEqual(headers);
  });

  it('RpcProvider constructor leaves fetchOptions empty without headers', () => {
    const rpc = new RpcProvider({
      chain: mainnet,
      rpcUrls: ['https://example.com'],
    });

    expect(innerTransports(rpc).length).toBe(1);
    expect(headersOf(rpc)).toBeUndefined();
  });
});

describe('createRpcProvider — header passthrough (Phase 11)', () => {
  it('passes rpcHeaders through to the underlying RpcProvider', () => {
    const headers = { Authorization: 'Bearer abc' };
    const rpc = createRpcProvider({
      chain: mainnet,
      rpcUrls: ['https://example.com'],
      rpcHeaders: headers,
    });

    expect(innerTransports(rpc).length).toBe(1);
    expect(headersOf(rpc)).toEqual(headers);
  });

  it('throws when neither rpcUrls nor rpcUrl are provided (unchanged from Phase 9)', () => {
    expect(() =>
      createRpcProvider({ chain: mainnet, rpcUrls: [] }),
    ).toThrow(/no RPC URLs provided/);
  });

  it('falls back to rpcUrl when rpcUrls is empty (deprecated path still works)', () => {
    const rpc = createRpcProvider({
      chain: mainnet,
      rpcUrl: 'https://example.com',
      rpcUrls: [],
    });
    expect(rpc.chainId).toBe(mainnet.id);
  });
});

// Reference unused helpers so future readers can re-use them
// without TS unused-locals warnings.
void headersOf;
void urlOf;
void innerTransports;
