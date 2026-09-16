import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export type Theme = 'parchment' | 'ink' | 'auto'

export const THEMES: ReadonlyArray<Theme> = ['parchment', 'ink', 'auto']

export interface DiceSettings {
  showInline: boolean
  defaultDie: number
  history: number
}

export interface CalendarSettings {
  monthsPerYear: number
  daysPerMonth: number
  yearSuffix: string
}

export interface AppSettings {
  theme: Theme
  dice: DiceSettings
  calendar: CalendarSettings
}

const STORAGE_KEY = 'sagemark:settings:v1'

function defaultSettings(): AppSettings {
  return {
    theme: 'parchment',
    dice: { showInline: true, defaultDie: 20, history: 10 },
    calendar: { monthsPerYear: 12, daysPerMonth: 30, yearSuffix: '' },
  }
}

function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return defaultSettings()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings()
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const d = defaultSettings()
    return {
      theme: (parsed.theme && THEMES.includes(parsed.theme)) ? parsed.theme : d.theme,
      dice: {
        showInline: parsed.dice?.showInline ?? d.dice.showInline,
        defaultDie: Number.isInteger(parsed.dice?.defaultDie) ? (parsed.dice!.defaultDie as number) : d.dice.defaultDie,
        history: Number.isInteger(parsed.dice?.history) ? (parsed.dice!.history as number) : d.dice.history,
      },
      calendar: {
        monthsPerYear: parsed.calendar?.monthsPerYear ?? d.calendar.monthsPerYear,
        daysPerMonth: parsed.calendar?.daysPerMonth ?? d.calendar.daysPerMonth,
        yearSuffix: parsed.calendar?.yearSuffix ?? d.calendar.yearSuffix,
      },
    }
  } catch {
    return defaultSettings()
  }
}

function persist(settings: AppSettings): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // best-effort
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(loadSettings())

  function setTheme(theme: Theme): void {
    settings.value = { ...settings.value, theme }
    persist(settings.value)
  }

  function setDice(dice: Partial<DiceSettings>): void {
    settings.value = {
      ...settings.value,
      dice: { ...settings.value.dice, ...dice },
    }
    persist(settings.value)
  }

  function setCalendar(calendar: Partial<CalendarSettings>): void {
    settings.value = {
      ...settings.value,
      calendar: { ...settings.value.calendar, ...calendar },
    }
    persist(settings.value)
  }

  function reset(): void {
    settings.value = defaultSettings()
    persist(settings.value)
  }

  const theme = computed(() => settings.value.theme)
  const dice = computed(() => settings.value.dice)
  const calendar = computed(() => settings.value.calendar)

  // Keep storage in sync if anything else mutates settings.value directly
  watch(settings, (s) => persist(s), { deep: true })

  return {
    settings,
    theme,
    dice,
    calendar,
    setTheme,
    setDice,
    setCalendar,
    reset,
  }
})
