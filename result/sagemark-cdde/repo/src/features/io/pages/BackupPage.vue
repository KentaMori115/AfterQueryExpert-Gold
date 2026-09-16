<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { exportAsJson, fileNameFor } from '../useExport'
import { ImportParseError, previewImport } from '../useImport'
import { parseCharactersCsv } from '../csvImport'

const route = useRoute()
const campaigns = useCampaignStore()
const characters = useCharacterStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const exportText = ref('')
const csvText = ref('')
const importStatus = ref<{ ok: boolean; imported: number; errors: number } | null>(null)
const previewText = ref('')
const previewReport = ref<string>('')
const previewError = ref<string>('')

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Backup' },
])

function buildExport(): void {
  if (!campaign.value) return
  const text = exportAsJson(campaign.value.id as CampaignId)
  exportText.value = text ?? '(nothing to export)'
}

function downloadExport(): void {
  if (!campaign.value || !exportText.value) return
  const blob = new Blob([exportText.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileNameFor(campaign.value.name)
  a.click()
  URL.revokeObjectURL(url)
}

function inspectBundle(): void {
  previewReport.value = ''
  previewError.value = ''
  try {
    const preview = previewImport(previewText.value)
    const lines = Object.entries(preview.counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}: ${n}`)
    previewReport.value = `v${preview.version} bundle for ${preview.campaignId}\n${lines.join('\n')}`
  } catch (err) {
    if (err instanceof ImportParseError) {
      previewError.value = err.message
    } else {
      previewError.value = 'unexpected error reading the bundle'
    }
  }
}

function importCsv(): void {
  if (!campaign.value) return
  const result = parseCharactersCsv(csvText.value, campaign.value.id as CampaignId)
  if (!result.ok) {
    importStatus.value = { ok: false, imported: result.imported.length, errors: result.errors.length }
    return
  }
  for (const draft of result.imported) {
    characters.create(draft)
  }
  importStatus.value = { ok: true, imported: result.imported.length, errors: 0 }
  csvText.value = ''
}
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader title="Backup and import" subtitle="Local-first means you own the file." />

      <SurfaceCard title="Export to JSON" hint="The whole campaign, in a single file">
        <div class="flex flex-wrap gap-2">
          <BaseButton @click="buildExport">Build export</BaseButton>
          <BaseButton tone="primary" :disabled="!exportText" @click="downloadExport">
            Download
          </BaseButton>
        </div>
        <textarea
          v-if="exportText"
          readonly
          rows="12"
          class="mt-3 w-full text-xs font-mono border border-parchment-300 rounded-soft px-2 py-2 bg-parchment-50"
          :value="exportText"
        />
      </SurfaceCard>

      <SurfaceCard title="Inspect a backup bundle" hint="Drop a JSON paste in to see what is inside">
        <textarea
          id="bundle-input"
          v-model="previewText"
          rows="6"
          placeholder='{ "version": 2, "campaignId": "..." }'
          class="w-full text-xs font-mono border border-parchment-300 rounded-soft px-2 py-2 bg-white"
        />
        <div class="flex justify-end mt-2">
          <BaseButton :disabled="!previewText.trim()" @click="inspectBundle">Inspect</BaseButton>
        </div>
        <pre
          v-if="previewReport"
          class="mt-2 text-xs whitespace-pre-line bg-parchment-50 p-2 rounded-soft"
        >{{ previewReport }}</pre>
        <p v-if="previewError" class="mt-2 text-sm text-crimson-600">{{ previewError }}</p>
      </SurfaceCard>

      <SurfaceCard title="Import characters from CSV" hint='First row is the header, "name" required'>
        <textarea
          id="csv-input"
          v-model="csvText"
          rows="6"
          placeholder="name,ancestry,vocation,level&#10;Iris,human,scout,5"
          class="w-full text-xs font-mono border border-parchment-300 rounded-soft px-2 py-2 bg-white"
        />
        <div class="flex justify-end mt-2">
          <BaseButton tone="primary" :disabled="!csvText.trim()" @click="importCsv">
            Import
          </BaseButton>
        </div>
        <p v-if="importStatus" class="mt-2 text-sm" :class="importStatus.ok ? 'text-moss-600' : 'text-crimson-600'">
          {{ importStatus.ok
            ? `Imported ${importStatus.imported} character${importStatus.imported === 1 ? '' : 's'}.`
            : `Could not import. ${importStatus.errors} row error(s).` }}
        </p>
      </SurfaceCard>
    </template>
  </section>
</template>
