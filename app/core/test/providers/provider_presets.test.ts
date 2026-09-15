// app/core/test/providers/provider_presets.test.ts

/**
 * Phase 11 — access-key slice. Unit tests for the provider
 * presets that translate `(preset, key)` into a concrete URL
 * and/or header map. These are the building blocks that
 * `RpcSettings.vue` and the plugin use to wire the user's
 * pinned key through to viem.
 */

import { describe, expect, it } from 'vitest';

import {
  RPC_PROVIDER_PRESETS,
  buildPresetHeaders,
  buildPresetUrl,
  chainSlug,
  findPreset,
} from '@core/providers/rpc';

describe('provider_presets', () => {
  describe('RPC_PROVIDER_PRESETS', () => {
    it('exposes the four commercial presets plus Custom', () => {
      const ids = RPC_PROVIDER_PRESETS.map((p) => p.id);
      expect(ids).toContain('alchemy');
      expect(ids).toContain('infura');
      expect(ids).toContain('ankr');
      expect(ids).toContain('tenderly');
      expect(ids).toContain('custom');
    });

    it('marks every commercial preset as supported on all four bundled chains', () => {
      for (const p of RPC_PROVIDER_PRESETS) {
        for (const id of [1, 42161, 8453, 146]) {
          expect(p.supportedChainIds).toContain(id);
        }
      }
    });
  });

  describe('findPreset', () => {
    it('returns the preset for a known id', () => {
      expect(findPreset('alchemy')?.label).toBe('Alchemy');
      expect(findPreset('infura')?.label).toBe('Infura');
      expect(findPreset('ankr')?.label).toBe('Ankr');
      expect(findPreset('tenderly')?.label).toContain('Tenderly');
      expect(findPreset('custom')?.label).toContain('Custom');
    });

    it('returns undefined for an unknown id', () => {
      expect(findPreset('not-a-provider')).toBeUndefined();
      expect(findPreset('')).toBeUndefined();
    });
  });

  describe('chainSlug', () => {
    it('returns the canonical commercial host slug per chain', () => {
      expect(chainSlug(1)).toBe('eth-mainnet');
      expect(chainSlug(42161)).toBe('arb-mainnet');
      expect(chainSlug(8453)).toBe('base-mainnet');
      expect(chainSlug(146)).toBe('sonic-mainnet');
    });

    it('falls back to chain-<id> for unknown chains', () => {
      expect(chainSlug(999)).toBe('chain-999');
    });
  });

  describe('buildPresetUrl', () => {
    it('expands an Alchemy URL template with chain slug + key', () => {
      const alchemy = findPreset('alchemy')!;
      const url = buildPresetUrl(alchemy, 1, 'demo-key');
      expect(url).toBe('https://eth-mainnet.g.alchemy.com/v2/demo-key');
    });

    it('expands Alchemy URLs for Arbitrum, Base, and Sonic', () => {
      const alchemy = findPreset('alchemy')!;
      expect(buildPresetUrl(alchemy, 42161, 'k')).toBe(
        'https://arb-mainnet.g.alchemy.com/v2/k',
      );
      expect(buildPresetUrl(alchemy, 8453, 'k')).toBe(
        'https://base-mainnet.g.alchemy.com/v2/k',
      );
      expect(buildPresetUrl(alchemy, 146, 'k')).toBe(
        'https://sonic-mainnet.g.alchemy.com/v2/k',
      );
    });

    it('expands an Infura URL template', () => {
      const infura = findPreset('infura')!;
      expect(buildPresetUrl(infura, 1, 'abcd')).toBe(
        'https://eth-mainnet.infura.io/v3/abcd',
      );
    });

    it('expands an Ankr URL template', () => {
      const ankr = findPreset('ankr')!;
      expect(buildPresetUrl(ankr, 8453, 'abc')).toBe(
        'https://rpc.ankr.com/base-mainnet/abc',
      );
    });

    it('encodes keys with special characters so URL parsing is safe', () => {
      const alchemy = findPreset('alchemy')!;
      const url = buildPresetUrl(alchemy, 1, 'with space/slash');
      expect(url).toBe(
        'https://eth-mainnet.g.alchemy.com/v2/with%20space%2Fslash',
      );
    });

    it('returns null for the Custom preset (no template)', () => {
      const custom = findPreset('custom')!;
      expect(buildPresetUrl(custom, 1, 'anything')).toBeNull();
    });
  });

  describe('buildPresetHeaders', () => {
    it('returns an empty object for URL-embed presets', () => {
      expect(buildPresetHeaders(findPreset('alchemy')!, 'k')).toEqual({});
      expect(buildPresetHeaders(findPreset('infura')!, 'k')).toEqual({});
      expect(buildPresetHeaders(findPreset('ankr')!, 'k')).toEqual({});
    });

    it('returns an empty object for Custom', () => {
      expect(buildPresetHeaders(findPreset('custom')!, 'k')).toEqual({});
    });

    it('emits the configured header for header-mode presets', () => {
      const tenderly = findPreset('tenderly')!;
      expect(buildPresetHeaders(tenderly, 'secret-key')).toEqual({
        'X-Forwarded-Key': 'secret-key',
      });
    });

    it('substitutes {key} in the header value template', () => {
      // Build an inline preset with a Bearer template to make sure
      // the substitution path handles non-trivial templates.
      const fakePreset = {
        id: 'fake-bearer',
        label: 'Fake Bearer',
        urlTemplate: 'https://example.com/{key}',
        mode: 'header' as const,
        headerName: 'Authorization',
        headerValueTemplate: 'Bearer {key}',
        supportedChainIds: [1],
      };
      expect(buildPresetHeaders(fakePreset, 'abcd')).toEqual({
        Authorization: 'Bearer abcd',
      });
    });
  });
});
