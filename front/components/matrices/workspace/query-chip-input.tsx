'use client'

import { FilterChipButton } from '@/components/shared/filter-chip-button'
import type { QuerySuggestion } from '@/lib/matrix-workspace-query'

export type QueryChip = {
  key: string
  label: string
  title?: string
  mono?: boolean
}

type QueryChipInputProps = {
  id: string
  label: string
  chips: QueryChip[]
  text: string
  placeholder: string
  error?: string
  examples: Array<{ label: string; onSelect: () => void }>
  suggestions: QuerySuggestion[]
  onTextChange: (value: string) => void
  onCommit: (value: string) => void
  onRemove: (key: string) => void
  onSuggestion: (suggestion: QuerySuggestion) => void
  onBackspaceEmpty: () => void
}

export function QueryChipInput({
  id,
  label,
  chips,
  text,
  placeholder,
  error,
  examples,
  suggestions,
  onTextChange,
  onCommit,
  onRemove,
  onSuggestion,
  onBackspaceEmpty,
}: QueryChipInputProps) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-ring/30">
        <div className="flex min-h-11 flex-wrap items-center gap-1.5 px-2 py-1.5">
          {chips.map((chip) => (
            <FilterChipButton
              key={chip.key}
              label={chip.label}
              title={chip.title}
              mono={chip.mono}
              onRemove={() => onRemove(chip.key)}
            />
          ))}
          <input
            id={id}
            value={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              const value = event.target.value
              if (value.includes(',')) {
                onCommit(value)
                return
              }
              onTextChange(value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onCommit(text)
              }
              if (event.key === 'Backspace' && !text && chips.length) {
                event.preventDefault()
                onBackspaceEmpty()
              }
            }}
            placeholder={chips.length ? 'Add another…' : placeholder}
            className="min-w-[8rem] flex-1 border-0 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="listbox" aria-label={`${label} suggestions`}>
          {suggestions.map((suggestion) => (
            <button
              key={`${suggestion.label}:${suggestion.token}`}
              type="button"
              role="option"
              className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSuggestion(suggestion)}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
      {examples.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Examples</span>
          {examples.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={example.onSelect}
              className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              {example.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="text-[11px] text-destructive" role="status">
          {error}
        </p>
      )}
    </div>
  )
}
