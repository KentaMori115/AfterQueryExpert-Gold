// Hotkey utility used by the shell and other top level pages. Hotkey
// definitions are a tiny chord syntax: tokens separated by plus signs, where a
// token is one of mod, ctrl, alt, shift, escape, enter, space, or a single
// character. The first token list is the primary chord; alternative chords are
// supplied as a list of strings.

export interface Hotkey {
  combos: ReadonlyArray<string>
  description: string
  // When true, the handler still runs while the user is typing in an input.
  whileTyping?: boolean
  handler: (event: KeyboardEvent) => void
}

export interface BoundHotkey {
  dispose: () => void
  hotkey: Hotkey
}

const MOD_FLAG_ALIASES: Record<string, keyof KeyboardEvent | null> = {
  mod: null,
  ctrl: 'ctrlKey',
  control: 'ctrlKey',
  alt: 'altKey',
  option: 'altKey',
  shift: 'shiftKey',
  meta: 'metaKey',
  cmd: 'metaKey',
  win: 'metaKey',
}

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
}

export function matchesCombo(event: KeyboardEvent, combo: string): boolean {
  const tokens = combo
    .toLowerCase()
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length === 0) return false
  const flags: Partial<Record<keyof KeyboardEvent, boolean>> = {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  }
  let keyToken: string | null = null
  for (const token of tokens) {
    if (token === 'mod') {
      if (isMac()) flags.metaKey = true
      else flags.ctrlKey = true
      continue
    }
    if (MOD_FLAG_ALIASES[token]) {
      flags[MOD_FLAG_ALIASES[token] as keyof KeyboardEvent] = true
      continue
    }
    keyToken = normaliseKey(token)
  }
  if (!keyToken) return false
  if ((flags.ctrlKey ?? false) !== event.ctrlKey) return false
  if ((flags.altKey ?? false) !== event.altKey) return false
  if ((flags.shiftKey ?? false) !== event.shiftKey) return false
  if ((flags.metaKey ?? false) !== event.metaKey) return false
  return normaliseKey(event.key) === keyToken
}

function normaliseKey(key: string): string {
  switch (key.toLowerCase()) {
    case 'esc':
    case 'escape':
      return 'escape'
    case 'enter':
    case 'return':
      return 'enter'
    case 'space':
    case ' ':
      return ' '
    case 'arrowup':
    case 'up':
      return 'arrowup'
    case 'arrowdown':
    case 'down':
      return 'arrowdown'
    case 'arrowleft':
    case 'left':
      return 'arrowleft'
    case 'arrowright':
    case 'right':
      return 'arrowright'
    default:
      return key.toLowerCase()
  }
}

export function isTypingInto(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

export function registerHotkeys(hotkeys: ReadonlyArray<Hotkey>): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: KeyboardEvent): void => {
    for (const hk of hotkeys) {
      if (!hk.whileTyping && isTypingInto(event.target)) continue
      for (const combo of hk.combos) {
        if (matchesCombo(event, combo)) {
          event.preventDefault()
          hk.handler(event)
          return
        }
      }
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}

export function describeShortcut(combo: string): string {
  return combo
    .split('+')
    .map((t) => t.trim())
    .map((t) => {
      if (t === 'mod') return isMac() ? '⌘' : 'Ctrl'
      if (t === 'shift') return '⇧'
      if (t === 'alt' || t === 'option') return isMac() ? '⌥' : 'Alt'
      if (t === 'escape') return 'Esc'
      if (t === 'enter') return '↵'
      if (t.length === 1) return t.toUpperCase()
      return t.replace(/^./, (c) => c.toUpperCase())
    })
    .join(' ')
}
