<script setup lang="ts">

// app/components/RpcSettings.vue
//
// Per-chain RPC settings panel. Phase 9 slice 4 (URL-only) +
// Phase 11 (access-key slice — paid providers like Alchemy /
// Infura / Tenderly authenticate via HTTP header rather than
// URL-embed).
//
// What the user sees per chain
// ----------------------------
//
//   1. A **provider preset** dropdown: Alchemy / Infura / Ankr /
//      Tenderly (fork) / Custom (raw URL).
//
//   2. A **single masked key field** (for presets) OR the existing
//      raw-URL field (for "Custom"). The key field is
//      `type="password"` with an eye-icon toggle to reveal.
//
//   3. For header-mode presets (Tenderly today), an inline note
//      about which header is being sent.
//
// Saving pins (preset, key) → (url, headers) into `useRpcOverride`,
// which persists to localStorage. Reload is still required for the
// plugin to pick the new config up.
//
// Validation is intentionally lightweight: a non-empty string that
// parses as `http://` or `https://` (URL-embed mode), or any
// non-empty string for the key field (header mode — we cannot
// verify the key without making a live RPC call from a form
// input).

import type { TChainId } from '@core/shared/types';
import {
  RPC_PROVIDER_PRESETS,
  buildPresetHeaders,
  buildPresetUrl,
  findPreset,
  type IRpcProviderPreset,
} from '@core/providers/rpc';

const override = useRpcOverride();
const toast = useToast();

interface IChainRow {
  chainId: TChainId;
  name: string;
  defaultUrl: string;

  /** Current preset id (`alchemy` / `custom` / etc.) or '' for none. */
  presetId: string;

  /**
   * Draft access key (for presets) or full URL (for Custom).
   * Shown masked in the UI; never round-tripped to the user via
   * `getConfig().key` outside this component.
   */
  draft: string;

  /**
   * Whether to reveal the key in the input. Eye-icon toggle.
   */
  revealed: boolean;

  /** Last validation error, if any. */
  error: string;

  /**
   * Human-readable summary of the saved config, used in the
   * "currently pinned" hint below the field. Empty when nothing
   * is pinned.
   */
  pinnedSummary: string;
}

function chainNameFor(chainId: number): string {
  return BUNDLED_NETWORKS.find((n) => n.id === chainId)?.display
    ?? `Chain ${chainId}`;
}

function chainDefaultUrl(chainId: number): string {
  return BUNDLED_NETWORKS.find((n) => n.id === chainId)?.rpcUrls[0] ?? '';
}

function summarizePinned(
  chainId: TChainId,
  cfg: { preset?: string; url?: string; headers?: Record<string, string> },
): string {
  if (!cfg.url && !cfg.headers) return '';

  const parts: string[] = [];
  if (cfg.url) parts.push(cfg.url);
  if (cfg.headers) {
    for (const [k, v] of Object.entries(cfg.headers)) {
      // Mask the value: keep the first 4 and last 2 chars when long
      // enough, otherwise show "***". Never leak the full secret.
      const masked = v.length > 8
        ? `${v.slice(0, 4)}…${v.slice(-2)}`
        : '***';
      parts.push(`${k}: ${masked}`);
    }
  }

  if (cfg.preset && cfg.preset !== 'custom') {
    const preset = findPreset(cfg.preset);
    return `${preset?.label ?? cfg.preset} → ${parts.join(', ')}`;
  }

  return parts.join(', ');
}

const rows = computed<IChainRow[]>(() => {
  // Build one row per bundled chain, seeded from the current
  // override (if any) so the form reflects persisted state.
  return BUNDLED_NETWORKS.map((n) => {
    const cfg = override.getConfig(n.id);
    const presetId = cfg.preset ?? 'custom';
    const draft = presetId === 'custom'
      ? (cfg.url ?? '')
      : (cfg.key ?? '');
    return {
      chainId: n.id as TChainId,
      name: chainNameFor(n.id),
      defaultUrl: chainDefaultUrl(n.id),
      presetId,
      draft,
      revealed: false,
      error: '',
      pinnedSummary: summarizePinned(n.id as TChainId, cfg),
    };
  });
});

function isValidUrl(s: string): boolean {
  if (s.length === 0) return true; // empty == "use default"
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  }
  catch {
    return false;
  }
}

function activePreset(row: IChainRow): IRpcProviderPreset | undefined {
  return findPreset(row.presetId);
}

function isHeaderMode(row: IChainRow): boolean {
  return activePreset(row)?.mode === 'header';
}

function placeholderFor(row: IChainRow): string {
  const preset = activePreset(row);
  if (!preset || preset.id === 'custom') return row.defaultUrl;
  // Show the resolved URL with a `{key}` placeholder so the user
  // sees what they'll get. Encode a 6-char fake key for visual
  // approximation of length.
  return preset.urlTemplate.replace('{key}', 'xxxxxxxx');
}

function headerNoteFor(row: IChainRow): string {
  const preset = activePreset(row);
  if (!preset || preset.mode !== 'header') return '';
  const name = preset.headerName ?? '';
  const tmpl = preset.headerValueTemplate ?? '{key}';
  // Substitute a sample value so the user sees the exact header
  // shape (e.g. "X-Forwarded-Key: xxxx…xxxx").
  const value = tmpl.replace('{key}', 'xxxxxxxx');
  return `Sent as header: ${name}: ${value}`;
}

function onPresetChange(row: IChainRow, newPresetId: string) {
  row.presetId = newPresetId;
  // Reset the draft when switching presets — keeping a key/URL
  // from the previous provider in the field would silently
  // commit against the new preset's URL template on save.
  row.draft = '';
  row.error = '';
}

function saveRow(row: IChainRow) {
  const preset = activePreset(row);

  if (!preset) {
    row.error = 'Pick a provider preset.';
    return;
  }

  // Custom: validate as URL.
  if (preset.id === 'custom') {
    if (!isValidUrl(row.draft)) {
      row.error = 'Must be an empty value or a full http(s) URL.';
      return;
    }
    if (row.draft.trim().length === 0) {
      override.clearConfig(row.chainId);
      row.pinnedSummary = '';
      row.draft = '';
      toast.add({
        title: 'Custom RPC cleared',
        description: `${row.name} → public fallbacks. Reload to apply.`,
        color: 'info',
        icon: 'i-lucide-info',
      });
      return;
    }
    override.setConfig(row.chainId, {
      preset: 'custom',
      url: row.draft.trim(),
    });
    const cfg = override.getConfig(row.chainId);
    row.pinnedSummary = summarizePinned(row.chainId, cfg);
    toast.add({
      title: 'Custom RPC saved',
      description: `${row.name} → ${cfg.url ?? '(empty)'}. Reload to apply.`,
      color: 'success',
      icon: 'i-lucide-check-circle',
    });
    return;
  }

  // Preset: validate as non-empty key.
  if (row.draft.trim().length === 0) {
    row.error = 'Paste your API key for this provider.';
    return;
  }

  const url = buildPresetUrl(preset, row.chainId, row.draft.trim());
  if (!url) {
    row.error = `Provider "${preset.label}" can't build a URL for ${row.name}.`;
    return;
  }
  const headers = buildPresetHeaders(preset, row.draft.trim());

  override.setConfig(row.chainId, {
    preset: preset.id,
    url,
    headers,
    key: row.draft.trim(),
  });

  const cfg = override.getConfig(row.chainId);
  row.pinnedSummary = summarizePinned(row.chainId, cfg);
  row.error = '';
  toast.add({
    title: `${preset.label} saved`,
    description: `${row.name} → ${cfg.url ?? '(empty)'}. Reload to apply.`,
    color: 'success',
    icon: 'i-lucide-check-circle',
  });
}

function clearRow(row: IChainRow) {
  override.clearConfig(row.chainId);
  row.draft = '';
  row.error = '';
  row.pinnedSummary = '';
  toast.add({
    title: 'Custom RPC cleared',
    description: `${row.name} → public fallbacks. Reload to apply.`,
    color: 'info',
    icon: 'i-lucide-info',
  });
}
</script>

<template>
  <div class="space-y-6">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-info"
      title="Custom RPC endpoints &amp; access keys"
      description="Pin a personal endpoint (Alchemy / Infura / Ankr / Tenderly fork / private node) per chain. Key-based providers authenticate via header (Alchemy, Infura) or URL-embed (Ankr). Your key is stored only in your browser — it never leaves this device. A page reload is required for changes to take effect."
    />

    <div
      v-for="row in rows"
      :key="row.chainId"
      class="space-y-3 pb-5 border-b border-default last:border-0"
    >
      <div class="flex items-baseline justify-between gap-3">
        <label
          :for="`rpc-preset-${row.chainId}`"
          class="text-sm font-medium"
        >
          {{ row.name }}
        </label>
        <span class="text-xs text-muted">
          default: <code>{{ row.defaultUrl }}</code>
        </span>
      </div>

      <!-- Preset selector -->
      <USelectMenu
        :id="`rpc-preset-${row.chainId}`"
        :model-value="row.presetId"
        :items="RPC_PROVIDER_PRESETS
          .filter((p) => p.supportedChainIds.includes(row.chainId))
          .map((p) => ({ label: p.label, value: p.id }))"
        value-key="value"
        size="sm"
        @update:model-value="(v: string) => onPresetChange(row, v)"
      />

      <!-- Key / URL field — type switches between password and url -->
      <div class="relative">
        <UInput
          :id="`rpc-key-${row.chainId}`"
          v-model="row.draft"
          :type="(activePreset(row)?.id === 'custom' || row.revealed) ? 'text' : 'password'"
          :placeholder="placeholderFor(row)"
          :color="row.error ? 'error' : 'primary'"
          size="sm"
          autocomplete="off"
          spellcheck="false"
        >
          <template
            v-if="activePreset(row)?.id !== 'custom' && row.draft.length > 0"
            #trailing
          >
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              :icon="row.revealed ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              :aria-label="row.revealed ? 'Hide key' : 'Show key'"
              @click="row.revealed = !row.revealed"
            />
          </template>
        </UInput>
      </div>

      <p
        v-if="isHeaderMode(row)"
        class="text-xs text-muted"
      >
        <UIcon name="i-lucide-shield" class="align-text-bottom" />
        {{ headerNoteFor(row) }}
      </p>

      <p
        v-if="row.error"
        class="text-xs text-error"
      >
        {{ row.error }}
      </p>
      <p
        v-else-if="row.pinnedSummary"
        class="text-xs text-success"
      >
        <UIcon name="i-lucide-check" class="align-text-bottom" />
        Pinned: <code>{{ row.pinnedSummary }}</code>
      </p>

      <div class="flex gap-2">
        <UButton
          size="xs"
          color="primary"
          icon="i-lucide-save"
          @click="saveRow(row)"
        >
          Save
        </UButton>
        <UButton
          v-if="row.pinnedSummary"
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-lucide-x"
          @click="clearRow(row)"
        >
          Clear
        </UButton>
      </div>
    </div>

    <p class="text-xs text-muted text-center">
      <UIcon name="i-lucide-lock" class="align-text-bottom" />
      Stored locally in your browser only. Not transmitted to any server.
    </p>
  </div>
</template>
