<script setup lang="ts">
// app/layouts/default.vue

// Minimal top bar — used by every page that opts into this
// layout (see `definePageMeta({ layout: 'default' })`).
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <UHeader>
      <template #title>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-bar-chart-3" />
          <span>Analyze Web3</span>
        </div>
      </template>

      <template #right>
        <NuxtLink to="/">
          <UButton color="primary" variant="subtle" icon="i-lucide-search">
            Discover
          </UButton>
        </NuxtLink>
      </template>
    </UHeader>

    <main class="flex-1">
      <slot />
    </main>

    <UFooter>
      <template #left>
        <p class="text-xs text-muted">
          Client-side LP analytics. No wallet required. Numbers derived from public RPCs.
        </p>
      </template>
    </UFooter>
  </div>
</template>
