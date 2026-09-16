import { computed, type ComputedRef } from 'vue'
import { useRouter } from 'vue-router'

import type { CampaignId } from '@core/ids'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'
import { useLocationStore } from '@features/locations/store'
import { useSessionStore } from '@features/sessions/store'

export type CommandKind = 'navigation' | 'campaign' | 'character' | 'faction' | 'location' | 'session'

export interface PaletteCommand {
  id: string
  kind: CommandKind
  label: string
  hint: string
  keywords: string[]
  perform: () => void
}

export function useCommands(): { commands: ComputedRef<PaletteCommand[]>; search: (query: string) => PaletteCommand[] } {
  const router = useRouter()
  const campaigns = useCampaignStore()
  const characters = useCharacterStore()
  const factions = useFactionStore()
  const locations = useLocationStore()
  const sessions = useSessionStore()

  const commands = computed<PaletteCommand[]>(() => {
    const out: PaletteCommand[] = []
    out.push(
      navCmd('home', 'Go home', '/', 'home dashboard start'),
      navCmd('campaigns', 'Open campaigns list', '/campaigns', 'campaigns list browse'),
      navCmd('dashboard', 'Open dashboard', '/dashboard', 'dashboard overview totals'),
      navCmd('new-campaign', 'New campaign', '/campaigns/new', 'new create campaign'),
      navCmd('dice', 'Open dice roller', '/dice', 'dice roll roller'),
      navCmd('recycle', 'Open recycle bin', '/recycle', 'recycle bin deleted'),
      navCmd('settings', 'Open settings', '/settings', 'settings preferences'),
      navCmd('shortcuts', 'Show keyboard shortcuts', '/shortcuts', 'shortcuts keyboard hotkeys'),
      navCmd('rules', 'Open rule snippets', '/rules', 'rules snippets reference'),
      navCmd('journal', 'Open GM journal', '/journal', 'journal mood diary'),
    )

    const active = campaigns.active
    if (active) {
      const cid = active.id
      out.push(navCmd(`campaign-${cid}`, `Open active campaign: ${active.name}`, `/campaigns/${cid}`, `campaign ${active.name}`))
      out.push(navCmd(`sessions-${cid}`, 'Open sessions', `/campaigns/${cid}/sessions`, 'sessions'))
      out.push(navCmd(`characters-${cid}`, 'Open cast', `/campaigns/${cid}/characters`, 'characters cast party'))
      out.push(navCmd(`factions-${cid}`, 'Open factions', `/campaigns/${cid}/factions`, 'factions'))
      out.push(navCmd(`locations-${cid}`, 'Open world', `/campaigns/${cid}/locations`, 'world places'))
      out.push(navCmd(`arcs-${cid}`, 'Open arcs', `/campaigns/${cid}/arcs`, 'arcs storylines'))
      out.push(navCmd(`encounters-${cid}`, 'Open encounters', `/campaigns/${cid}/encounters`, 'encounters combat'))
      out.push(navCmd(`relationships-${cid}`, 'Open bonds', `/campaigns/${cid}/relationships`, 'bonds relationships graph'))
      out.push(navCmd(`lore-${cid}`, 'Open lore', `/campaigns/${cid}/lore`, 'lore wiki'))
      out.push(navCmd(`quests-${cid}`, 'Open quests', `/campaigns/${cid}/quests`, 'quests log'))
      out.push(navCmd(`items-${cid}`, 'Open loot', `/campaigns/${cid}/items`, 'loot items'))
      out.push(navCmd(`timeline-${cid}`, 'Open timeline', `/campaigns/${cid}/timeline`, 'timeline events'))
      out.push(navCmd(`search-${cid}`, 'Search this campaign', `/campaigns/${cid}/search`, 'search'))
      out.push(navCmd(`notes-${cid}`, 'Open notes inbox', `/campaigns/${cid}/notes`, 'notes inbox'))
      out.push(navCmd(`reports-${cid}`, 'Open reports', `/campaigns/${cid}/reports`, 'reports stats'))
      out.push(navCmd(`backup-${cid}`, 'Open backup', `/campaigns/${cid}/backup`, 'backup export'))
      out.push(navCmd(`handouts-${cid}`, 'Open handouts', `/campaigns/${cid}/handouts`, 'handouts player'))
      out.push(navCmd(`tags-${cid}`, 'Open tags', `/campaigns/${cid}/tags`, 'tags labels'))
      out.push(navCmd(`tag-browse-${cid}`, 'Browse by tag', `/campaigns/${cid}/tags/browse`, 'tag browse filter'))
      out.push(navCmd(`prep-${cid}`, 'Open prep checklist', `/campaigns/${cid}/prep`, 'prep checklist'))
      out.push(navCmd(`downtime-${cid}`, 'Open downtime', `/campaigns/${cid}/downtime`, 'downtime activities crafting'))
      out.push(navCmd(`generators-${cid}`, 'Open generators', `/campaigns/${cid}/generators`, 'generators npc tavern street rumor'))
      out.push(navCmd(`bench-${cid}`, 'Difficulty bench', `/campaigns/${cid}/encounters/bench`, 'difficulty bench encounter calculator'))
      out.push(navCmd(`library-${cid}`, 'Encounter library', `/campaigns/${cid}/encounters/library`, 'encounter library presets'))
      out.push(navCmd(`travel-${cid}`, 'Travel planner', `/campaigns/${cid}/travel`, 'travel weather pace'))
      out.push(navCmd(`recap-${cid}`, 'Session recap', `/campaigns/${cid}/recap`, 'recap summary discord'))
      out.push(navCmd(`treasury-${cid}`, 'Treasury', `/campaigns/${cid}/treasury`, 'treasury coin party purse'))
      out.push(navCmd(`holidays-${cid}`, 'Holidays', `/campaigns/${cid}/holidays`, 'holidays festival calendar'))
      out.push(navCmd(`pulse-${cid}`, 'Pulse', `/campaigns/${cid}/pulse`, 'pulse status freshness'))
      out.push(navCmd(`party-${cid}`, 'Party', `/campaigns/${cid}/party`, 'party lineup roster'))

      const cidT = cid as CampaignId
      for (const ch of characters.forCampaign(cidT)) {
        out.push({
          id: `character-${ch.id}`,
          kind: 'character',
          label: `Open character: ${ch.name}`,
          hint: ch.vocation || ch.ancestry || 'character',
          keywords: [ch.name, ch.ancestry, ch.vocation].filter(Boolean) as string[],
          perform: () => router.push(`/campaigns/${cid}/characters/${ch.id}`),
        })
      }
      for (const f of factions.forCampaign(cidT)) {
        out.push({
          id: `faction-${f.id}`,
          kind: 'faction',
          label: `Open faction: ${f.name}`,
          hint: f.motto || 'faction',
          keywords: [f.name, f.motto].filter(Boolean) as string[],
          perform: () => router.push(`/campaigns/${cid}/factions/${f.id}`),
        })
      }
      for (const loc of locations.forCampaign(cidT)) {
        out.push({
          id: `location-${loc.id}`,
          kind: 'location',
          label: `Open place: ${loc.name}`,
          hint: loc.shortDescription || 'place',
          keywords: [loc.name, loc.shortDescription].filter(Boolean) as string[],
          perform: () => router.push(`/campaigns/${cid}/locations/${loc.id}`),
        })
      }
      for (const s of sessions.forCampaign(cidT)) {
        const label = s.title || `Session ${s.number}`
        out.push({
          id: `session-${s.id}`,
          kind: 'session',
          label: `Open session: ${label}`,
          hint: 'session',
          keywords: [label, String(s.number)],
          perform: () => router.push(`/campaigns/${cid}/sessions/${s.id}`),
        })
      }
    }

    for (const c of campaigns.all) {
      out.push({
        id: `switch-${c.id}`,
        kind: 'campaign',
        label: `Switch to: ${c.name}`,
        hint: c.tagline || 'campaign',
        keywords: [c.name, c.tagline, 'switch'].filter(Boolean) as string[],
        perform: () => {
          campaigns.setActive(c.id)
          router.push(`/campaigns/${c.id}`)
        },
      })
    }

    return out
  })

  function search(query: string): PaletteCommand[] {
    const q = query.trim().toLowerCase()
    if (!q) return commands.value.slice(0, 12)
    const terms = q.split(/\s+/).filter(Boolean)
    return commands.value
      .map((cmd) => ({ cmd, score: scoreCommand(cmd, terms) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.cmd)
      .slice(0, 16)
  }

  return { commands, search }

  function navCmd(id: string, label: string, route: string, keywords: string): PaletteCommand {
    return {
      id,
      kind: 'navigation',
      label,
      hint: route,
      keywords: keywords.split(/\s+/),
      perform: () => router.push(route),
    }
  }
}

function scoreCommand(cmd: PaletteCommand, terms: string[]): number {
  const haystack = [cmd.label, cmd.hint, ...cmd.keywords].join(' ').toLowerCase()
  let total = 0
  for (const term of terms) {
    if (!haystack.includes(term)) return 0
    if (cmd.label.toLowerCase().startsWith(term)) total += 4
    else if (cmd.label.toLowerCase().includes(term)) total += 3
    else if (cmd.keywords.some((k) => k.toLowerCase().startsWith(term))) total += 2
    else total += 1
  }
  return total
}
