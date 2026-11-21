// app/core/test/providers/market/defi_llama_market_data_provider.test.ts

/**
 * Slice 2 — the DefiLlama market-data provider.
 *
 * Every test runs against a **stubbed transport** (no network): the
 * payloads are the ones DefiLlama actually returned on 2026-11-18,
 * copied verbatim from TVL-ROADMAP.md §3.2 / §3.3 / §3.4.
 *
 * The suite asserts the two halves of the provider's contract:
 *   - the **happy path** — floats converted to exact bigints, the
 *     natural-key match, the history parsing;
 *   - the **degradation path** — a provider never throws for
 *     "data unavailable", it returns `null` / `[]`.
 */

import { describe, expect, it } from 'vitest';

import {
  DefiLlamaMarketDataProvider,
  createMarketDataProvider,
  parseDefiLlamaFee,
} from '@core/providers/market';

import {
  BASE_USDC,
  BASE_WETH,
  BASE_WETH_USDC_POOL,
  BASE_WETH_USDC_POOL_ID,
  DEFI_LLAMA_E1_SAMPLE,
  DEFI_LLAMA_E2_SAMPLE,
  DEFI_LLAMA_E3_SAMPLE,
  SHADOW_POOL,
  SHADOW_POOL_ID,
  SHADOW_TOKEN,
  SONIC_USDC,
} from '../../_fixtures/defi_llama_fixture';

import type { TAddress } from '@core/shared/types';

/** What the stubbed transport answers with. */
interface IFetchStubReply {
  /** HTTP status — defaults to 200. */
  readonly status?: number;

  /** JSON body — serialized by the stub. */
  readonly body?: unknown;

  /** Verbatim body — used to simulate an unparseable payload. */
  readonly raw?: string;
}

/**
 * A `fetch` stub: answers from a caller-supplied router and records
 * every URL it was asked for.
 *
 * The router may return an `Error` to simulate a transport failure
 * (the provider has to survive it).
 */
function createFetchStub(
  route: (url: string) => IFetchStubReply | Error,
): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];

  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    calls.push(url);

    const reply = route(url);

    if (reply instanceof Error) {
      throw reply;
    }

    const status = reply.status ?? 200;
    const text = reply.raw !== undefined
      ? reply.raw
      : JSON.stringify(reply.body ?? null);

    return new Response(text, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { fetchImpl, calls };
}

/** The router that serves the three sample endpoints. */
function sampleRoute(url: string): IFetchStubReply {
  if (url.startsWith('https://coins.llama.fi/prices/current/')) {
    return { body: DEFI_LLAMA_E1_SAMPLE };
  }

  if (url === 'https://yields.llama.fi/pools') {
    return { body: DEFI_LLAMA_E2_SAMPLE };
  }

  if (url.startsWith('https://yields.llama.fi/chart/')) {
    return { body: DEFI_LLAMA_E3_SAMPLE };
  }

  return { status: 404, body: { error: 'not found' } };
}

/** Count how many of the recorded URLs hit the yields index. */
function countIndexCalls(calls: readonly string[]): number {
  return calls.filter((url) => url === 'https://yields.llama.fi/pools').length;
}

/** Count how many of the recorded URLs hit the prices endpoint. */
function countPriceCalls(calls: readonly string[]): number {
  return calls.filter((url) => url.startsWith('https://coins.llama.fi/')).length;
}

describe('DefiLlamaMarketDataProvider', () => {
  describe('getTokenPrices', () => {
    it('parses the E1 float price into an exact 1e18 bigint', async () => {
      const { fetchImpl } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({
        fetchImpl,
        now: () => 1_700_000_000n,
      });

      const prices = await provider.getTokenPrices(8453, [BASE_WETH]);

      expect(prices).toHaveLength(1);
      expect(prices[0]?.token).toBe(BASE_WETH);
      // The double 1797.0162017200657 is *not* 1797.016201720065700000:
      // its exact decimal expansion is 1797.016201720065737391.
      expect(prices[0]?.usdPrice).toBe(1_797_016_201_720_065_737_391n);
      // 0.99 in IEEE-754 is 0.989999999999999991…
      expect(prices[0]?.confidence).toBe(989_999_999_999_999_991n);
      expect(prices[0]?.timestamp).toBe(1_794_998_399n);
    });

    it('batches every token of a chain into a single request', async () => {
      const { fetchImpl, calls } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      await provider.getTokenPrices(8453, [BASE_WETH, BASE_USDC]);

      expect(countPriceCalls(calls)).toBe(1);
      expect(calls[0]).toContain('base:0x4200000000000000000000000000000000000006');
      expect(calls[0]).toContain('base:0x833589fcd6edb6e08f4c7c32d4f71b54da02913');
    });

    it('omits tokens DefiLlama does not know', async () => {
      const { fetchImpl } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const unknown = '0x0000000000000000000000000000000000000abc' as TAddress;
      const prices = await provider.getTokenPrices(8453, [unknown]);

      expect(prices).toHaveLength(0);
    });

    it('ignores coins of another chain in the same payload', async () => {
      const { fetchImpl } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const prices = await provider.getTokenPrices(8453, [SONIC_USDC]);

      expect(prices).toHaveLength(0);
    });

    it('returns an empty list for a chain DefiLlama does not know', async () => {
      const { fetchImpl, calls } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const prices = await provider.getTokenPrices(999, [BASE_WETH]);

      expect(prices).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });

    it('returns an empty list when the request fails', async () => {
      const { fetchImpl } = createFetchStub(() => new Error('network down'));
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const prices = await provider.getTokenPrices(8453, [BASE_WETH]);

      expect(prices).toHaveLength(0);
    });

    it('returns an empty list when the response is not JSON', async () => {
      const { fetchImpl } = createFetchStub(() => ({ raw: '<html>nope</html>' }));
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const prices = await provider.getTokenPrices(8453, [BASE_WETH]);

      expect(prices).toHaveLength(0);
    });

    it('caches the prices for 60 seconds', async () => {
      const { fetchImpl, calls } = createFetchStub(sampleRoute);
      let clock = 1_700_000_000n;
      const provider = new DefiLlamaMarketDataProvider({
        fetchImpl,
        now: () => clock,
      });

      await provider.getTokenPrices(8453, [BASE_WETH]);
      clock += 59n;
      await provider.getTokenPrices(8453, [BASE_WETH]);

      expect(countPriceCalls(calls)).toBe(1);

      clock += 2n;
      await provider.getTokenPrices(8453, [BASE_WETH]);

      expect(countPriceCalls(calls)).toBe(2);
    });
  });

  describe('getPoolLiquidity', () => {
    it('matches the Base WETH/USDC 0.3% entry and scales its money', async () => {
      const { fetchImpl } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({
        fetchImpl,
        now: () => 1_700_000_000n,
      });

      const liquidity = await provider.getPoolLiquidity(
        8453,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        3000,
      );

      expect(liquidity).not.toBeNull();
      expect(liquidity?.pool).toBe(BASE_WETH_USDC_POOL);
      expect(liquidity?.chainId).toBe(8453);
      expect(liquidity?.protocolId).toBe('uniswap-v3');
      expect(liquidity?.tvlUsd).toBe(88_992_532_000_000n);
      expect(liquidity?.volume24hUsd).toBe(87_887_325_213_650n);
      expect(liquidity?.externalPoolId).toBe(BASE_WETH_USDC_POOL_ID);
      expect(liquidity?.source).toBe('defi-llama');
      expect(liquidity?.timestamp).toBe(1_700_000_000n);
    });

    it('matches a Shadow pool whose fee tier carries the "CL " prefix', async () => {
      const { fetchImpl } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const liquidity = await provider.getPoolLiquidity(
        146,
        'shadow-cl',
        SHADOW_POOL,
        SONIC_USDC,
        SHADOW_TOKEN,
        2400,
      );

      expect(liquidity).not.toBeNull();
      expect(liquidity?.tvlUsd).toBe(1_234_567_890_000n);
      // `volumeUsd1d` is null in the payload → "unknown" → 0n.
      expect(liquidity?.volume24hUsd).toBe(0n);
      expect(liquidity?.externalPoolId).toBe(SHADOW_POOL_ID);
      expect(liquidity?.source).toBe('defi-llama');
    });

    it('matches the pair regardless of the token order', async () => {
      const { fetchImpl } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const liquidity = await provider.getPoolLiquidity(
        8453,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_USDC,
        BASE_WETH,
        3000,
      );

      expect(liquidity?.externalPoolId).toBe(BASE_WETH_USDC_POOL_ID);
    });

    it('returns null for a fee tier the index does not list', async () => {
      const { fetchImpl } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const liquidity = await provider.getPoolLiquidity(
        8453,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        500,
      );

      expect(liquidity).toBeNull();
    });

    it('returns null for an unknown chain without touching the network', async () => {
      const { fetchImpl, calls } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const liquidity = await provider.getPoolLiquidity(
        999,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        3000,
      );

      expect(liquidity).toBeNull();
      expect(calls).toHaveLength(0);
    });

    it('returns null for a protocol DefiLlama does not index', async () => {
      const { fetchImpl, calls } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const liquidity = await provider.getPoolLiquidity(
        8453,
        'curve-v2',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        3000,
      );

      expect(liquidity).toBeNull();
      expect(calls).toHaveLength(0);
    });

    it('returns null when the index request fails', async () => {
      const { fetchImpl } = createFetchStub(() => new Error('network down'));
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const liquidity = await provider.getPoolLiquidity(
        8453,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        3000,
      );

      expect(liquidity).toBeNull();
    });

    it('returns null when the index answers with an error status', async () => {
      const { fetchImpl } = createFetchStub(() => ({ status: 500, body: {} }));
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const liquidity = await provider.getPoolLiquidity(
        8453,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        3000,
      );

      expect(liquidity).toBeNull();
    });

    it('downloads the index once and reuses it', async () => {
      const { fetchImpl, calls } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      await provider.getPoolLiquidity(
        8453,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        3000,
      );
      await provider.getPoolLiquidity(
        146,
        'shadow-cl',
        SHADOW_POOL,
        SONIC_USDC,
        SHADOW_TOKEN,
        2400,
      );

      expect(countIndexCalls(calls)).toBe(1);
    });

    it('shares one in-flight index download between concurrent callers', async () => {
      const { fetchImpl, calls } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const [a, b] = await Promise.all([
        provider.getPoolLiquidity(
          8453,
          'uniswap-v3',
          BASE_WETH_USDC_POOL,
          BASE_WETH,
          BASE_USDC,
          3000,
        ),
        provider.getPoolLiquidity(
          146,
          'shadow-cl',
          SHADOW_POOL,
          SONIC_USDC,
          SHADOW_TOKEN,
          2400,
        ),
      ]);

      expect(a?.externalPoolId).toBe(BASE_WETH_USDC_POOL_ID);
      expect(b?.externalPoolId).toBe(SHADOW_POOL_ID);
      expect(countIndexCalls(calls)).toBe(1);
    });

    it('refreshes the index once the hour is up', async () => {
      const { fetchImpl, calls } = createFetchStub(sampleRoute);
      let clock = 1_700_000_000n;
      const provider = new DefiLlamaMarketDataProvider({
        fetchImpl,
        now: () => clock,
      });

      await provider.getPoolLiquidity(
        8453,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        3000,
      );
      clock += 3601n;
      await provider.getPoolLiquidity(
        8453,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        3000,
      );

      expect(countIndexCalls(calls)).toBe(2);
    });
  });

  describe('getPoolTvlHistory', () => {
    it('returns the history of a matched pool with unix timestamps', async () => {
      const { fetchImpl } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      await provider.getPoolLiquidity(
        8453,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        3000,
      );

      const history = await provider.getPoolTvlHistory(8453, BASE_WETH_USDC_POOL);

      expect(history).not.toBeNull();
      expect(history).toHaveLength(2);
      expect(history?.[0]?.timestamp).toBe(1_701_644_717n);
      expect(history?.[0]?.tvlUsd).toBe(1_002_000_000n);
      expect(history?.[1]?.timestamp).toBe(1_701_731_117n);
      expect(history?.[1]?.tvlUsd).toBe(1_500_500_000n);
    });

    it('returns null for a pool that was never matched', async () => {
      const { fetchImpl, calls } = createFetchStub(sampleRoute);
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      const history = await provider.getPoolTvlHistory(8453, BASE_WETH_USDC_POOL);

      expect(history).toBeNull();
      expect(calls).toHaveLength(0);
    });

    it('returns null when the chart request fails', async () => {
      const { fetchImpl } = createFetchStub((url) => (
        url.startsWith('https://yields.llama.fi/chart/')
          ? new Error('network down')
          : sampleRoute(url)
      ));
      const provider = new DefiLlamaMarketDataProvider({ fetchImpl });

      await provider.getPoolLiquidity(
        8453,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        3000,
      );

      const history = await provider.getPoolTvlHistory(8453, BASE_WETH_USDC_POOL);

      expect(history).toBeNull();
    });

    it('caches the history for 10 minutes', async () => {
      const { fetchImpl, calls } = createFetchStub(sampleRoute);
      let clock = 1_700_000_000n;
      const provider = new DefiLlamaMarketDataProvider({
        fetchImpl,
        now: () => clock,
      });

      await provider.getPoolLiquidity(
        8453,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        3000,
      );

      await provider.getPoolTvlHistory(8453, BASE_WETH_USDC_POOL);
      clock += 599n;
      await provider.getPoolTvlHistory(8453, BASE_WETH_USDC_POOL);

      const chartCalls = calls.filter(
        (url) => url.startsWith('https://yields.llama.fi/chart/'),
      );

      expect(chartCalls).toHaveLength(1);

      clock += 2n;
      await provider.getPoolTvlHistory(8453, BASE_WETH_USDC_POOL);

      const chartCallsAfter = calls.filter(
        (url) => url.startsWith('https://yields.llama.fi/chart/'),
      );

      expect(chartCallsAfter).toHaveLength(2);
    });
  });

  describe('parseDefiLlamaFee', () => {
    it('parses the documented fee tiers into hundredths of a basis point', () => {
      expect(parseDefiLlamaFee('0.05%')).toBe(500);
      expect(parseDefiLlamaFee('0.3%')).toBe(3000);
      expect(parseDefiLlamaFee('0.30%')).toBe(3000);
      expect(parseDefiLlamaFee('1%')).toBe(10_000);
      expect(parseDefiLlamaFee('0.01%')).toBe(100);
    });

    it('strips the Shadow "CL " prefix before parsing', () => {
      expect(parseDefiLlamaFee('CL 0.24%')).toBe(2400);
      expect(parseDefiLlamaFee('cl 0.05%')).toBe(500);
    });

    it('returns null for a value that is not a percentage', () => {
      expect(parseDefiLlamaFee('n/a')).toBeNull();
      expect(parseDefiLlamaFee('')).toBeNull();
    });
  });

  describe('createMarketDataProvider', () => {
    it('builds the DefiLlama provider by default', () => {
      const provider = createMarketDataProvider();

      expect(provider.id).toBe('defi-llama');
      expect(provider.name).toBe('DefiLlama');
      expect(provider.version).toBe('1');
    });

    it('accepts an injected transport and clock', async () => {
      const { fetchImpl } = createFetchStub(sampleRoute);
      const provider = createMarketDataProvider({
        fetchImpl,
        now: () => 1_700_000_000n,
      });

      const liquidity = await provider.getPoolLiquidity(
        8453,
        'uniswap-v3',
        BASE_WETH_USDC_POOL,
        BASE_WETH,
        BASE_USDC,
        3000,
      );

      expect(liquidity?.timestamp).toBe(1_700_000_000n);
    });
  });
});
