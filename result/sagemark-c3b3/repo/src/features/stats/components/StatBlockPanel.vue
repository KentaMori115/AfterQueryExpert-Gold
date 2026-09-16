<script setup lang="ts">
import { computed, ref } from 'vue'

import type { CharacterId } from '@core/ids'
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  abilityModifier,
  carryingCapacity,
  formatModifier,
  hpStatus,
  passivePerception,
  type AbilityKey,
} from '@core/rules/stat-block'

import BaseButton from '@ui/primitives/BaseButton.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

import { useStatBlockStore } from '../store'

const props = defineProps<{
  characterId: CharacterId
  perceptionProficient?: boolean
}>()

const stats = useStatBlockStore()
const block = computed(() => stats.get(props.characterId))

const damageDraft = ref<number>(5)
const healDraft = ref<number>(5)

const HP_TONES: Record<ReturnType<typeof hpStatus>, 'success' | 'info' | 'warning' | 'danger'> = {
  fresh: 'success',
  bloodied: 'info',
  critical: 'warning',
  down: 'danger',
}

function takeDamage(): void {
  if (damageDraft.value > 0) stats.damage(props.characterId, damageDraft.value)
}

function heal(): void {
  if (healDraft.value > 0) stats.heal(props.characterId, healDraft.value)
}

function rest(): void {
  stats.fullRest(props.characterId)
}

function bumpAbility(key: AbilityKey, delta: number): void {
  stats.setAbility(props.characterId, key, block.value.abilities[key] + delta)
}

function adjustMax(delta: number): void {
  stats.configureMax(props.characterId, block.value.hpMax + delta)
}

function adjustAc(delta: number): void {
  stats.setAc(props.characterId, block.value.ac + delta)
}

function adjustSpeed(delta: number): void {
  stats.setSpeed(props.characterId, block.value.speed + delta)
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-center gap-3">
      <StatusBadge :tone="HP_TONES[hpStatus(block)]" :soft="false">
        {{ block.hp }} / {{ block.hpMax }} hp
      </StatusBadge>
      <div class="flex items-center gap-1 text-xs">
        <button class="px-2 py-0.5 rounded-soft bg-parchment-200 hover:bg-parchment-300" @click="adjustMax(-1)">-1 max</button>
        <button class="px-2 py-0.5 rounded-soft bg-parchment-200 hover:bg-parchment-300" @click="adjustMax(1)">+1 max</button>
      </div>
      <div class="flex items-center gap-1 text-xs">
        <span class="text-ink-500">AC</span>
        <button class="px-2 py-0.5 rounded-soft bg-parchment-200 hover:bg-parchment-300" @click="adjustAc(-1)">-</button>
        <span class="font-mono">{{ block.ac }}</span>
        <button class="px-2 py-0.5 rounded-soft bg-parchment-200 hover:bg-parchment-300" @click="adjustAc(1)">+</button>
      </div>
      <div class="flex items-center gap-1 text-xs">
        <span class="text-ink-500">Speed</span>
        <button class="px-2 py-0.5 rounded-soft bg-parchment-200 hover:bg-parchment-300" @click="adjustSpeed(-5)">-5</button>
        <span class="font-mono">{{ block.speed }}</span>
        <button class="px-2 py-0.5 rounded-soft bg-parchment-200 hover:bg-parchment-300" @click="adjustSpeed(5)">+5</button>
      </div>
    </header>

    <div class="flex flex-wrap gap-3 text-sm items-end">
      <label class="text-xs text-ink-500">
        Damage
        <input
          id="dmg-input"
          v-model.number="damageDraft"
          type="number"
          min="0"
          class="mt-1 w-20 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        />
      </label>
      <BaseButton size="sm" tone="danger" @click="takeDamage">apply damage</BaseButton>
      <label class="text-xs text-ink-500">
        Heal
        <input
          id="heal-input"
          v-model.number="healDraft"
          type="number"
          min="0"
          class="mt-1 w-20 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        />
      </label>
      <BaseButton size="sm" @click="heal">apply heal</BaseButton>
      <BaseButton size="sm" tone="primary" @click="rest">full rest</BaseButton>
    </div>

    <div class="grid grid-cols-3 gap-2 text-xs">
      <div
        v-for="key in ABILITY_KEYS"
        :key="key"
        class="surface p-2 flex flex-col items-center gap-1"
      >
        <span class="uppercase tracking-wide text-ink-500">{{ ABILITY_LABELS[key].slice(0, 3).toUpperCase() }}</span>
        <div class="flex items-center gap-1">
          <button class="px-1 rounded-soft bg-parchment-200 hover:bg-parchment-300" @click="bumpAbility(key, -1)">-</button>
          <span class="font-mono text-base text-ink-900">{{ block.abilities[key] }}</span>
          <button class="px-1 rounded-soft bg-parchment-200 hover:bg-parchment-300" @click="bumpAbility(key, 1)">+</button>
        </div>
        <span class="font-mono text-ink-700">{{ formatModifier(abilityModifier(block.abilities[key])) }}</span>
      </div>
    </div>

    <footer class="grid grid-cols-2 gap-3 text-xs text-ink-600">
      <div>
        <span class="text-ink-500">Passive perception: </span>
        <span class="font-mono">{{ passivePerception(block, perceptionProficient ?? false) }}</span>
      </div>
      <div>
        <span class="text-ink-500">Carry capacity: </span>
        <span class="font-mono">{{ carryingCapacity(block) }} lb</span>
      </div>
      <div>
        <span class="text-ink-500">Proficiency: </span>
        <span class="font-mono">{{ formatModifier(block.proficiencyBonus) }}</span>
      </div>
      <div>
        <span class="text-ink-500">Hit dice: </span>
        <span class="font-mono">{{ block.hitDice }}</span>
      </div>
    </footer>
  </div>
</template>
