import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

import ArcDetailPage from '@features/arcs/pages/ArcDetailPage.vue'
import ArcEditPage from '@features/arcs/pages/ArcEditPage.vue'
import ArcNewPage from '@features/arcs/pages/ArcNewPage.vue'
import ArcsBoardPage from '@features/arcs/pages/ArcsBoardPage.vue'
import CampaignDetailPage from '@features/campaigns/pages/CampaignDetailPage.vue'
import CampaignEditPage from '@features/campaigns/pages/CampaignEditPage.vue'
import CampaignNewPage from '@features/campaigns/pages/CampaignNewPage.vue'
import CampaignsListPage from '@features/campaigns/pages/CampaignsListPage.vue'
import EncounterDetailPage from '@features/encounters/pages/EncounterDetailPage.vue'
import EncounterDifficultyPage from '@features/encounters/pages/EncounterDifficultyPage.vue'
import EncounterLibraryPage from '@features/encounters/pages/EncounterLibraryPage.vue'
import EncounterEditPage from '@features/encounters/pages/EncounterEditPage.vue'
import EncounterNewPage from '@features/encounters/pages/EncounterNewPage.vue'
import EncountersListPage from '@features/encounters/pages/EncountersListPage.vue'
import RelationshipsPage from '@features/relationships/pages/RelationshipsPage.vue'
import CharacterDetailPage from '@features/characters/pages/CharacterDetailPage.vue'
import CharacterEditPage from '@features/characters/pages/CharacterEditPage.vue'
import CharacterNewPage from '@features/characters/pages/CharacterNewPage.vue'
import CharactersListPage from '@features/characters/pages/CharactersListPage.vue'
import FactionDetailPage from '@features/factions/pages/FactionDetailPage.vue'
import FactionEditPage from '@features/factions/pages/FactionEditPage.vue'
import FactionNewPage from '@features/factions/pages/FactionNewPage.vue'
import FactionsListPage from '@features/factions/pages/FactionsListPage.vue'
import LocationDetailPage from '@features/locations/pages/LocationDetailPage.vue'
import LocationEditPage from '@features/locations/pages/LocationEditPage.vue'
import LocationNewPage from '@features/locations/pages/LocationNewPage.vue'
import LocationsListPage from '@features/locations/pages/LocationsListPage.vue'
import LorePage from '@features/lore/pages/LorePage.vue'
import ItemsLedgerPage from '@features/items/pages/ItemsLedgerPage.vue'
import QuestsBoardPage from '@features/quests/pages/QuestsBoardPage.vue'
import TimelinePage from '@features/timeline/pages/TimelinePage.vue'
import SearchPage from '@features/search/pages/SearchPage.vue'
import BackupPage from '@features/io/pages/BackupPage.vue'
import SettingsPage from '@features/settings/pages/SettingsPage.vue'
import ReportsPage from '@features/reports/pages/ReportsPage.vue'
import NotesInboxPage from '@features/notes/pages/NotesInboxPage.vue'
import DicePage from '@features/dice/pages/DicePage.vue'
import RecycleBinPage from '@features/recycle/pages/RecycleBinPage.vue'
import DashboardPage from '@features/dashboard/pages/DashboardPage.vue'
import HandoutsPage from '@features/handouts/pages/HandoutsPage.vue'
import ShortcutsPage from '@features/shortcuts/pages/ShortcutsPage.vue'
import TagsAdminPage from '@features/tags/pages/TagsAdminPage.vue'
import TagBrowsePage from '@features/tags/pages/TagBrowsePage.vue'
import GeneratorsPage from '@features/generators/pages/GeneratorsPage.vue'
import PrepPage from '@features/prep/pages/PrepPage.vue'
import DowntimePage from '@features/downtime/pages/DowntimePage.vue'
import TravelPlannerPage from '@features/travel/pages/TravelPlannerPage.vue'
import RecapPage from '@features/recap/pages/RecapPage.vue'
import TreasuryPage from '@features/treasury/pages/TreasuryPage.vue'
import HolidaysPage from '@features/holidays/pages/HolidaysPage.vue'
import RulesPage from '@features/rules/pages/RulesPage.vue'
import JournalPage from '@features/journal/pages/JournalPage.vue'
import PartyPage from '@features/party/pages/PartyPage.vue'
import PulsePage from '@features/pulse/pages/PulsePage.vue'
import MapPage from '@features/map/pages/MapPage.vue'
import SessionDetailPage from '@features/sessions/pages/SessionDetailPage.vue'
import SessionEditPage from '@features/sessions/pages/SessionEditPage.vue'
import SessionNewPage from '@features/sessions/pages/SessionNewPage.vue'
import SessionsListPage from '@features/sessions/pages/SessionsListPage.vue'
import HomePage from '@features/home/pages/HomePage.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
    meta: { title: 'Home' },
  },
  {
    path: '/campaigns',
    name: 'campaigns',
    component: CampaignsListPage,
    meta: { title: 'Campaigns' },
  },
  {
    path: '/campaigns/new',
    name: 'campaigns.new',
    component: CampaignNewPage,
    meta: { title: 'New campaign' },
  },
  {
    path: '/campaigns/:id',
    name: 'campaigns.detail',
    component: CampaignDetailPage,
    meta: { title: 'Campaign' },
  },
  {
    path: '/campaigns/:id/edit',
    name: 'campaigns.edit',
    component: CampaignEditPage,
    meta: { title: 'Edit campaign' },
  },
  {
    path: '/campaigns/:campaignId/characters',
    name: 'characters',
    component: CharactersListPage,
    meta: { title: 'Cast' },
  },
  {
    path: '/campaigns/:campaignId/characters/new',
    name: 'characters.new',
    component: CharacterNewPage,
    meta: { title: 'New character' },
  },
  {
    path: '/campaigns/:campaignId/characters/:id',
    name: 'characters.detail',
    component: CharacterDetailPage,
    meta: { title: 'Character' },
  },
  {
    path: '/campaigns/:campaignId/characters/:id/edit',
    name: 'characters.edit',
    component: CharacterEditPage,
    meta: { title: 'Edit character' },
  },
  {
    path: '/campaigns/:campaignId/factions',
    name: 'factions',
    component: FactionsListPage,
    meta: { title: 'Factions' },
  },
  {
    path: '/campaigns/:campaignId/factions/new',
    name: 'factions.new',
    component: FactionNewPage,
    meta: { title: 'New faction' },
  },
  {
    path: '/campaigns/:campaignId/factions/:id',
    name: 'factions.detail',
    component: FactionDetailPage,
    meta: { title: 'Faction' },
  },
  {
    path: '/campaigns/:campaignId/factions/:id/edit',
    name: 'factions.edit',
    component: FactionEditPage,
    meta: { title: 'Edit faction' },
  },
  {
    path: '/campaigns/:campaignId/locations',
    name: 'locations',
    component: LocationsListPage,
    meta: { title: 'World' },
  },
  {
    path: '/campaigns/:campaignId/locations/new',
    name: 'locations.new',
    component: LocationNewPage,
    meta: { title: 'New place' },
  },
  {
    path: '/campaigns/:campaignId/locations/:id',
    name: 'locations.detail',
    component: LocationDetailPage,
    meta: { title: 'Place' },
  },
  {
    path: '/campaigns/:campaignId/locations/:id/edit',
    name: 'locations.edit',
    component: LocationEditPage,
    meta: { title: 'Edit place' },
  },
  {
    path: '/campaigns/:campaignId/sessions',
    name: 'sessions',
    component: SessionsListPage,
    meta: { title: 'Sessions' },
  },
  {
    path: '/campaigns/:campaignId/sessions/new',
    name: 'sessions.new',
    component: SessionNewPage,
    meta: { title: 'Log a session' },
  },
  {
    path: '/campaigns/:campaignId/sessions/:id',
    name: 'sessions.detail',
    component: SessionDetailPage,
    meta: { title: 'Session' },
  },
  {
    path: '/campaigns/:campaignId/sessions/:id/edit',
    name: 'sessions.edit',
    component: SessionEditPage,
    meta: { title: 'Edit session' },
  },
  {
    path: '/campaigns/:campaignId/arcs',
    name: 'arcs',
    component: ArcsBoardPage,
    meta: { title: 'Arcs' },
  },
  {
    path: '/campaigns/:campaignId/arcs/new',
    name: 'arcs.new',
    component: ArcNewPage,
    meta: { title: 'New arc' },
  },
  {
    path: '/campaigns/:campaignId/arcs/:id',
    name: 'arcs.detail',
    component: ArcDetailPage,
    meta: { title: 'Arc' },
  },
  {
    path: '/campaigns/:campaignId/arcs/:id/edit',
    name: 'arcs.edit',
    component: ArcEditPage,
    meta: { title: 'Edit arc' },
  },
  {
    path: '/campaigns/:campaignId/encounters',
    name: 'encounters',
    component: EncountersListPage,
    meta: { title: 'Encounters' },
  },
  {
    path: '/campaigns/:campaignId/encounters/bench',
    name: 'encounters.bench',
    component: EncounterDifficultyPage,
    meta: { title: 'Difficulty bench' },
  },
  {
    path: '/campaigns/:campaignId/encounters/library',
    name: 'encounters.library',
    component: EncounterLibraryPage,
    meta: { title: 'Encounter library' },
  },
  {
    path: '/campaigns/:campaignId/encounters/new',
    name: 'encounters.new',
    component: EncounterNewPage,
    meta: { title: 'New encounter' },
  },
  {
    path: '/campaigns/:campaignId/encounters/:id',
    name: 'encounters.detail',
    component: EncounterDetailPage,
    meta: { title: 'Encounter' },
  },
  {
    path: '/campaigns/:campaignId/encounters/:id/edit',
    name: 'encounters.edit',
    component: EncounterEditPage,
    meta: { title: 'Edit encounter' },
  },
  {
    path: '/campaigns/:campaignId/relationships',
    name: 'relationships',
    component: RelationshipsPage,
    meta: { title: 'Bonds' },
  },
  {
    path: '/campaigns/:campaignId/lore',
    name: 'lore',
    component: LorePage,
    meta: { title: 'Lore' },
  },
  {
    path: '/campaigns/:campaignId/items',
    name: 'items',
    component: ItemsLedgerPage,
    meta: { title: 'Loot' },
  },
  {
    path: '/campaigns/:campaignId/quests',
    name: 'quests',
    component: QuestsBoardPage,
    meta: { title: 'Quests' },
  },
  {
    path: '/campaigns/:campaignId/timeline',
    name: 'timeline',
    component: TimelinePage,
    meta: { title: 'Timeline' },
  },
  {
    path: '/campaigns/:campaignId/search',
    name: 'search',
    component: SearchPage,
    meta: { title: 'Search' },
  },
  {
    path: '/campaigns/:campaignId/backup',
    name: 'backup',
    component: BackupPage,
    meta: { title: 'Backup' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsPage,
    meta: { title: 'Settings' },
  },
  {
    path: '/campaigns/:campaignId/reports',
    name: 'reports',
    component: ReportsPage,
    meta: { title: 'Reports' },
  },
  {
    path: '/campaigns/:campaignId/notes',
    name: 'notes',
    component: NotesInboxPage,
    meta: { title: 'Notes' },
  },
  {
    path: '/dice',
    name: 'dice',
    component: DicePage,
    meta: { title: 'Dice' },
  },
  {
    path: '/recycle',
    name: 'recycle',
    component: RecycleBinPage,
    meta: { title: 'Recycle bin' },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: DashboardPage,
    meta: { title: 'Dashboard' },
  },
  {
    path: '/campaigns/:campaignId/handouts',
    name: 'handouts',
    component: HandoutsPage,
    meta: { title: 'Handouts' },
  },
  {
    path: '/shortcuts',
    name: 'shortcuts',
    component: ShortcutsPage,
    meta: { title: 'Shortcuts' },
  },
  {
    path: '/campaigns/:campaignId/tags',
    name: 'tags',
    component: TagsAdminPage,
    meta: { title: 'Tags' },
  },
  {
    path: '/campaigns/:campaignId/tags/browse',
    name: 'tags.browse',
    component: TagBrowsePage,
    meta: { title: 'Browse by tag' },
  },
  {
    path: '/campaigns/:campaignId/generators',
    name: 'generators',
    component: GeneratorsPage,
    meta: { title: 'Generators' },
  },
  {
    path: '/campaigns/:campaignId/prep',
    name: 'prep',
    component: PrepPage,
    meta: { title: 'Prep' },
  },
  {
    path: '/campaigns/:campaignId/prep/:sessionId',
    name: 'prep.session',
    component: PrepPage,
    meta: { title: 'Prep' },
  },
  {
    path: '/campaigns/:campaignId/downtime',
    name: 'downtime',
    component: DowntimePage,
    meta: { title: 'Downtime' },
  },
  {
    path: '/campaigns/:campaignId/travel',
    name: 'travel',
    component: TravelPlannerPage,
    meta: { title: 'Travel planner' },
  },
  {
    path: '/campaigns/:campaignId/recap',
    name: 'recap',
    component: RecapPage,
    meta: { title: 'Recap' },
  },
  {
    path: '/campaigns/:campaignId/treasury',
    name: 'treasury',
    component: TreasuryPage,
    meta: { title: 'Treasury' },
  },
  {
    path: '/campaigns/:campaignId/holidays',
    name: 'holidays',
    component: HolidaysPage,
    meta: { title: 'Holidays' },
  },
  {
    path: '/rules',
    name: 'rules',
    component: RulesPage,
    meta: { title: 'Rules' },
  },
  {
    path: '/journal',
    name: 'journal',
    component: JournalPage,
    meta: { title: 'Journal' },
  },
  {
    path: '/campaigns/:campaignId/party',
    name: 'party',
    component: PartyPage,
    meta: { title: 'Party' },
  },
  {
    path: '/campaigns/:campaignId/pulse',
    name: 'pulse',
    component: PulsePage,
    meta: { title: 'Pulse' },
  },
  {
    path: '/campaigns/:campaignId/map',
    name: 'map',
    component: MapPage,
    meta: { title: 'Map' },
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

router.afterEach((to) => {
  const base = 'Sagemark'
  const t = to.meta.title as string | undefined
  document.title = t ? `${t} - ${base}` : base
})
