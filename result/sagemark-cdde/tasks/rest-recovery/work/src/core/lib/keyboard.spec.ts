import { describe, expect, it, vi } from 'vitest'

import { describeShortcut, isTypingInto, matchesCombo, registerHotkeys } from './keyboard'

function press(key: string, mods: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ...mods })
}

describe('matchesCombo', () => {
  it('matches a single key', () => {
    expect(matchesCombo(press('k'), 'k')).toBe(true)
  })

  it('matches a modified combo', () => {
    expect(matchesCombo(press('k', { ctrlKey: true }), 'ctrl+k')).toBe(true)
    expect(matchesCombo(press('k', { ctrlKey: true }), 'k')).toBe(false)
  })

  it('treats mod as ctrl on non mac', () => {
    expect(matchesCombo(press('k', { ctrlKey: true }), 'mod+k')).toBe(true)
  })

  it('matches escape and enter aliases', () => {
    expect(matchesCombo(press('Escape'), 'escape')).toBe(true)
    expect(matchesCombo(press('Enter'), 'enter')).toBe(true)
  })

  it('matches arrow keys', () => {
    expect(matchesCombo(press('ArrowDown'), 'arrowdown')).toBe(true)
    expect(matchesCombo(press('ArrowDown'), 'down')).toBe(true)
  })

  it('requires every declared modifier', () => {
    expect(matchesCombo(press('k', { ctrlKey: true }), 'ctrl+shift+k')).toBe(false)
    expect(matchesCombo(press('k', { ctrlKey: true, shiftKey: true }), 'ctrl+shift+k')).toBe(true)
  })
})

describe('isTypingInto', () => {
  it('returns true for inputs and textareas', () => {
    const input = document.createElement('input')
    expect(isTypingInto(input)).toBe(true)
    const ta = document.createElement('textarea')
    expect(isTypingInto(ta)).toBe(true)
  })

  it('returns false for plain divs', () => {
    expect(isTypingInto(document.createElement('div'))).toBe(false)
  })

  it('returns true for contentEditable elements via the dom flag', () => {
    const div = document.createElement('div')
    Object.defineProperty(div, 'isContentEditable', { value: true })
    expect(isTypingInto(div)).toBe(true)
  })
})

describe('registerHotkeys', () => {
  it('fires the matching handler and prevents default', () => {
    const handler = vi.fn()
    const dispose = registerHotkeys([
      { combos: ['ctrl+k'], description: 'open palette', handler },
    ])
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })
    window.dispatchEvent(event)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    dispose()
  })

  it('skips handlers when typing into an input by default', () => {
    const handler = vi.fn()
    const dispose = registerHotkeys([
      { combos: ['k'], description: 'noop', handler },
    ])
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }))
    expect(handler).not.toHaveBeenCalled()
    document.body.removeChild(input)
    dispose()
  })

  it('runs whileTyping handlers even from an input', () => {
    const handler = vi.fn()
    const dispose = registerHotkeys([
      { combos: ['ctrl+enter'], description: 'submit', whileTyping: true, handler },
    ])
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    )
    expect(handler).toHaveBeenCalled()
    document.body.removeChild(input)
    dispose()
  })

  it('dispose removes the listener', () => {
    const handler = vi.fn()
    const dispose = registerHotkeys([{ combos: ['k'], description: 'k', handler }])
    dispose()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('describeShortcut', () => {
  it('humanises the chord', () => {
    expect(describeShortcut('ctrl+k')).toBe('Ctrl K')
    expect(describeShortcut('shift+enter')).toContain('↵')
  })
})
