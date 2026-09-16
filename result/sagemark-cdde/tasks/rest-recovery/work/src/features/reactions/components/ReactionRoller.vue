<script setup lang="ts">
import { computed, ref } from 'vue'

import { buildSeededRng } from '@core/dice/roll'
import {
  MORALE_TIERS,
  type MoraleTier,
  type ReactionMood,
  moodDescription,
  moodLabel,
  moodTone,
  rollMorale,
  rollReaction,
  tierLabel,
} from '@core/rules/reactions'

import BaseButton from '@ui/primitives/BaseButton.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

const modifier = ref<number>(0)
const tier = ref<MoraleTier>('steady')
const reactionSeed = ref<number>(Math.floor(Math.random() * 1_000_000))
const moraleSeed = ref<number>(Math.floor(Math.random() * 1_000_000))

const reaction = computed(() => rollReaction(buildSeededRng(reactionSeed.value), modifier.value))
const morale = computed(() => rollMorale(buildSeededRng(moraleSeed.value), tier.value))

const moodTones: Record<ReactionMood, 'danger' | 'warning' | 'info' | 'neutral' | 'success'> = {
  hostile: moodTone('hostile'),
  unfriendly: moodTone('unfriendly'),
  cautious: moodTone('cautious'),
  neutral: moodTone('neutral'),
  friendly: moodTone('friendly'),
  helpful: moodTone('helpful'),
}

function rerollReaction(): void {
  reactionSeed.value = Math.floor(Math.random() * 1_000_000)
}

function rerollMorale(): void {
  moraleSeed.value = Math.floor(Math.random() * 1_000_000)
}
</script>

<template>
  <div class="space-y-4">
    <section class="space-y-2">
      <header class="flex flex-wrap items-end gap-3">
        <label class="text-xs text-ink-500">
          Reaction modifier
          <input
            id="reaction-mod"
            v-model.number="modifier"
            type="number"
            min="-5"
            max="5"
            class="mt-1 w-20 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          />
        </label>
        <BaseButton size="sm" tone="primary" @click="rerollReaction">roll 2d6</BaseButton>
      </header>
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge :tone="moodTones[reaction.mood]" :soft="false">
          {{ moodLabel(reaction.mood) }}
        </StatusBadge>
        <span class="font-mono">{{ reaction.d1 }} + {{ reaction.d2 }} {{ reaction.modifier >= 0 ? 'add' : 'sub' }} {{ Math.abs(reaction.modifier) }} = {{ reaction.total }}</span>
      </div>
      <p class="text-xs text-ink-600">{{ moodDescription(reaction.mood) }}</p>
    </section>

    <section class="space-y-2">
      <header class="flex flex-wrap items-end gap-3">
        <label class="text-xs text-ink-500">
          Morale tier
          <select
            id="morale-tier"
            v-model="tier"
            class="mt-1 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          >
            <option v-for="t in MORALE_TIERS" :key="t" :value="t">{{ tierLabel(t) }}</option>
          </select>
        </label>
        <BaseButton size="sm" @click="rerollMorale">roll morale</BaseButton>
      </header>
      <div class="text-sm flex flex-wrap items-center gap-2">
        <StatusBadge :tone="morale.passed ? 'success' : 'danger'">
          {{ morale.passed ? 'holds' : 'breaks' }}
        </StatusBadge>
        <span class="font-mono">{{ morale.d1 }} + {{ morale.d2 }} = {{ morale.total }} vs {{ morale.rating }}</span>
        <span class="text-ink-500">margin {{ morale.margin }}</span>
      </div>
    </section>
  </div>
</template>
