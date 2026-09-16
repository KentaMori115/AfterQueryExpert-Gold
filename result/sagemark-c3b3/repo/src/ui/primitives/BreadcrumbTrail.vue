<script setup lang="ts">
import { RouterLink } from 'vue-router'

interface Crumb {
  to?: string
  label: string
}

defineProps<{
  crumbs: ReadonlyArray<Crumb>
}>()
</script>

<template>
  <nav aria-label="Breadcrumb" class="text-sm text-ink-500">
    <ol class="flex flex-wrap items-center gap-1">
      <li
        v-for="(crumb, i) in crumbs"
        :key="i"
        class="flex items-center gap-1"
      >
        <RouterLink
          v-if="crumb.to && i < crumbs.length - 1"
          :to="crumb.to"
          class="hover:text-ink-800"
        >
          {{ crumb.label }}
        </RouterLink>
        <span v-else class="text-ink-700">{{ crumb.label }}</span>
        <span v-if="i < crumbs.length - 1" class="text-ink-300" aria-hidden="true">/</span>
      </li>
    </ol>
  </nav>
</template>
