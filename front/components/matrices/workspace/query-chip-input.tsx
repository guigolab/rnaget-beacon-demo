'use client'

import { Popover } from '@base-ui/react/popover'
import type { CSSProperties, ReactNode } from 'react'
import type { QuerySuggestion } from '@/lib/matrix-workspace-query'

export type QueryExampleChip = {
  key: string
  label: string
  onSelect: () => void
  /** Term-type colours. */
  style?: CSSProperties
}

type QueryChipInputProps = {
  id: string
  label: string
  /** Whether Backspace on an empty input has a chip to remove. */
  hasChips: boolean
  text: string
  placeholder: string
  error?: string
  pinnedExamples: QueryExampleChip[]
  moreExamples: QueryExampleChip[]
  suggestions: QuerySuggestion[]
  onTextChange: (value: string) => void
  onCommit: (value: string) => void
  onSuggestion: (suggestion: QuerySuggestion) => void
  onBackspaceEmpty: () => void
  /** Filter-group popovers shown after the examples. */
  children?: ReactNode
}

const exampleChipClass =
  'rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:brightness-95'

export function QueryChipInput({
  id,
  label,
  hasChips,
  text,
  placeholder,
  error,
  pinnedExamples,
  moreExamples,
  suggestions,
  onTextChange,
  onCommit,
  onSuggestion,
  onBackspaceEmpty,
  children,
}: QueryChipInputProps) {
  const hasExamples = pinnedExamples.length > 0 || moreExamples.length > 0

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <div className="rounded-md border border-border bg-background focus-within:ring-2 focus-within:ring-ring/30">
        <div className="flex min-h-9 flex-wrap items-center gap-1.5 px-2 py-1">
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
              if (event.key === 'Backspace' && !text && hasChips) {
                event.preventDefault()
                onBackspaceEmpty()
              }
            }}
            placeholder={hasChips ? 'Add another…' : placeholder}
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
      {(hasExamples || children != null) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {pinnedExamples.map((example) => (
            <button
              key={example.key}
              type="button"
              onClick={example.onSelect}
              style={example.style}
              className={exampleChipClass}
            >
              {example.label}
            </button>
          ))}
          {moreExamples.length > 0 && (
            <Popover.Root>
              <Popover.Trigger type="button" className={exampleChipClass}>
                Examples ({moreExamples.length})
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner sideOffset={6} align="start" className="z-[200]">
                  <Popover.Popup className="z-[200] w-[min(100vw-2rem,16rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg outline-none">
                    <div className="border-b border-border px-3 py-2">
                      <Popover.Title className="text-xs font-semibold text-foreground">
                        Examples
                      </Popover.Title>
                    </div>
                    <ul className="max-h-56 overflow-y-auto p-1">
                      {moreExamples.map((example) => (
                        <li key={example.key}>
                          <Popover.Close
                            type="button"
                            className="block w-full rounded-md px-2.5 py-1.5 text-left text-[11px] text-foreground hover:bg-muted/70"
                            onClick={example.onSelect}
                            style={example.style}
                          >
                            {example.label}
                          </Popover.Close>
                        </li>
                      ))}
                    </ul>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          )}
          {children}
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
