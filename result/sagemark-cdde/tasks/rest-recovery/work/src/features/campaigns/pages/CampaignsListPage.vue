<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { useCampaignStore } from '../store'
import CampaignTile from '../components/CampaignTile.vue'
import BaseButton from '@ui/primitives/BaseButton.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'

const store = useCampaignStore()

const showShelved = ref(true)

const open = computed(() => store.open)
const archived = computed(() => (showShelved.value ? store.archived : []))
const isEmpty = computed(() => store.isEmpty)
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <PageHeader
      title="Campaigns"
      subtitle="Everything you keep alive between sessions, in one place."
      :meta="open.length + ' open / ' + (open.length + archived.length) + ' total'"
    >
      <label class="mr-3 text-xs text-ink-500 flex items-center gap-1">
        <input id="show-shelved" v-model="showShelved" type="checkbox" />
        show shelved
      </label>
      <RouterLink to="/campaigns/new">
        <BaseButton tone="primary">New campaign</BaseButton>
      </RouterLink>
    </PageHeader>

    <EmptyState
      v-if="isEmpty"
      title="No campaigns yet"
      description="Spin up your first campaign and you can start tracking the cast, the factions, and the lore beneath them."
      icon="*"
    >
      <template #action>
        <RouterLink to="/campaigns/new">
          <BaseButton tone="primary">Create one now</BaseButton>
        </RouterLink>
      </template>
    </EmptyState>

    <template v-else>
      <section v-if="open.length > 0">
        <h2 class="text-sm uppercase tracking-wider text-ink-400 mb-2">In play</h2>
        <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="c in open" :key="c.id">
            <RouterLink
              :to="`/campaigns/${c.id}`"
              class="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 rounded-soft"
            >
              <CampaignTile :campaign="c" :active="store.activeId === c.id" />
            </RouterLink>
          </li>
        </ul>
      </section>

      <section v-if="archived.length > 0">
        <h2 class="text-sm uppercase tracking-wider text-ink-400 mb-2">Shelved</h2>
        <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="c in archived" :key="c.id">
            <RouterLink
              :to="`/campaigns/${c.id}`"
              class="block focus:outline-none focus-visible:ring-2 focus-visible:ring-parchment-400 rounded-soft"
            >
              <CampaignTile :campaign="c" />
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>
