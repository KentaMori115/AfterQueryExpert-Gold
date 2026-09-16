<script setup lang="ts">
import { computed } from 'vue'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'

import DiceRoller from '../components/DiceRoller.vue'

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { label: 'Dice' },
])
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />
    <PageHeader title="Dice" subtitle="Roll, keep history, and save presets that match your game." />
    <DiceRoller />
  </section>
</template>
