import type { ReactNode } from 'react'

export function MetaBadge({
  children,
  variant = 'default',
  title,
}: {
  children: ReactNode
  variant?: 'default' | 'accent' | 'muted'
  title?: string
}) {
  const styles =
    variant === 'accent'
      ? 'border-primary/35 bg-primary/10 text-foreground'
      : variant === 'muted'
        ? 'border-border bg-muted/50 text-muted-foreground'
        : 'border-border bg-background text-foreground'
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${styles}`}
    >
      {children}
    </span>
  )
}
