'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type ComboboxOption = {
  id: string
  label: string
  hint?: string
}

type SearchComboboxProps = {
  label: string
  placeholder?: string
  emptyText?: string
  value?: ComboboxOption | null
  onSearch: (query: string) => Promise<ComboboxOption[]>
  onChange?: (option: ComboboxOption | null) => void
}

export function SearchCombobox({
  label,
  placeholder = 'Search',
  emptyText = 'No matches',
  value = null,
  onSearch,
  onChange,
}: SearchComboboxProps) {
  const instanceId = useId()
  const inputId = `${instanceId}-input`
  const listboxId = `${instanceId}-listbox`
  const statusId = `${instanceId}-status`
  const requestIdRef = useRef(0)

  const [query, setQuery] = useState(value?.label ?? '')
  const [options, setOptions] = useState<ComboboxOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selected, setSelected] = useState<ComboboxOption | null>(value)

  useEffect(() => {
    setSelected(value)
    if (value) {
      setQuery(value.label)
    }
  }, [value])

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    let cancelled = false

    onSearch(query)
      .then((result) => {
        if (cancelled || requestId !== requestIdRef.current) return
        setOptions(result)
        setActiveIndex(0)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled || requestId !== requestIdRef.current) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [query, onSearch])

  const choose = (option: ComboboxOption) => {
    setSelected(option)
    setQuery(option.label)
    setOpen(false)
    onChange?.(option)
  }

  const clear = () => {
    setSelected(null)
    setQuery('')
    setOpen(true)
    onChange?.(null)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.min(index + 1, Math.max(options.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && open && options[activeIndex]) {
      event.preventDefault()
      choose(options[activeIndex])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const statusText = loading
    ? 'Searching'
    : open
      ? `${options.length} results`
      : selected
        ? `Selected ${selected.label}`
        : 'No selection'

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[activeIndex] ? `${instanceId}-option-${options[activeIndex].id}` : undefined}
          aria-describedby={statusId}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            if (selected && event.target.value !== selected.label) {
              setSelected(null)
              onChange?.(null)
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {selected ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground underline-offset-2 hover:underline"
            onClick={clear}
          >
            Clear selection
          </button>
        ) : null}
      </div>
      <p id={statusId} role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {statusText}
      </p>
      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="max-h-56 overflow-auto rounded-md border bg-background p-1 shadow-sm"
        >
          {options.length === 0 && !loading ? (
            <li className="px-2 py-2 text-sm text-muted-foreground">{emptyText}</li>
          ) : (
            options.map((option, index) => (
              <li
                key={option.id}
                id={`${instanceId}-option-${option.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  'cursor-pointer rounded-sm px-2 py-2 text-sm',
                  index === activeIndex && 'bg-accent'
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <div className="font-medium">{option.label}</div>
                {option.hint ? (
                  <div className="text-xs text-muted-foreground">{option.hint}</div>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
