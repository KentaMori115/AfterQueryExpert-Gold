<script setup lang="ts">
import { computed, ref } from 'vue'

import type { CharacterId } from '@core/ids'
import {
  COIN_KINDS,
  type CoinKind,
  coinLabel,
  formatPurse,
  totalInGp,
} from '@core/rules/coin'
import { relativeFromNow } from '@core/time/timestamps'

import BaseButton from '@ui/primitives/BaseButton.vue'

import { useCoinStore } from '../store'

const props = defineProps<{
  characterId: CharacterId
}>()

const store = useCoinStore()

const purse = computed(() => store.purseFor(props.characterId))
const ledger = computed(() => [...store.ledgerFor(props.characterId)].reverse().slice(0, 8))

const bumpReason = ref<string>('')
const bumpKind = ref<CoinKind>('gp')
const bumpAmount = ref<number>(1)

function bump(): void {
  if (bumpAmount.value === 0) return
  store.bump(props.characterId, bumpKind.value, bumpAmount.value, bumpReason.value || 'untold')
  bumpReason.value = ''
}

function consolidate(): void {
  store.consolidate(props.characterId)
}

function clearLog(): void {
  if (!window.confirm('Clear the coin ledger for this character?')) return
  store.clearLedger(props.characterId)
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-center gap-3 text-sm">
      <span class="font-display text-lg text-ink-900">{{ totalInGp(purse) }} gp total</span>
      <span class="text-ink-500">{{ formatPurse(purse) }}</span>
      <div class="ml-auto flex gap-2">
        <BaseButton size="sm" @click="consolidate">consolidate</BaseButton>
        <BaseButton size="sm" tone="danger" @click="clearLog">clear log</BaseButton>
      </div>
    </header>

    <div class="grid grid-cols-5 gap-2 text-xs">
      <div
        v-for="kind in COIN_KINDS"
        :key="kind"
        class="surface p-2 flex flex-col items-center gap-1"
      >
        <span class="uppercase tracking-wide text-ink-500">{{ kind }}</span>
        <span class="font-mono text-base text-ink-900">{{ purse[kind] }}</span>
        <span class="text-ink-400">{{ coinLabel(kind) }}</span>
      </div>
    </div>

    <form class="grid grid-cols-1 sm:grid-cols-4 gap-2" @submit.prevent="bump">
      <select
        id="coin-kind"
        v-model="bumpKind"
        class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
      >
        <option v-for="kind in COIN_KINDS" :key="kind" :value="kind">{{ kind }}</option>
      </select>
      <input
        id="coin-amount"
        v-model.number="bumpAmount"
        type="number"
        class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
      />
      <input
        v-model="bumpReason"
        type="text"
        placeholder="reason (paid the bard)"
        class="sm:col-span-2 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
      />
      <BaseButton tone="primary" size="sm" type="submit" class="sm:col-span-4 sm:justify-self-end">
        log
      </BaseButton>
    </form>

    <section v-if="ledger.length > 0" class="space-y-1 text-xs">
      <h4 class="uppercase tracking-wide text-ink-500">Recent</h4>
      <ul class="space-y-1">
        <li v-for="entry in ledger" :key="entry.id" class="flex gap-2">
          <span class="font-mono w-16" :class="entry.delta >= 0 ? 'text-moss-600' : 'text-crimson-600'">
            {{ entry.delta >= 0 ? '+' : '' }}{{ entry.delta }} {{ entry.kind }}
          </span>
          <span class="text-ink-700">{{ entry.reason }}</span>
          <span class="ml-auto text-ink-400">{{ relativeFromNow(entry.at) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
