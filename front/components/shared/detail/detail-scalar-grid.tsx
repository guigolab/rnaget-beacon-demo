import type { FactLink } from '@/lib/beacon/facts'

export type ScalarRow = {
  label: string
  value?: string | null
  links?: FactLink[]
  wide?: boolean
}

export function DetailScalarGrid({ rows }: { rows: ScalarRow[] }) {
  const visible = rows.filter(
    (r) => (r.value && r.value.trim()) || (r.links && r.links.length > 0)
  )
  if (!visible.length) return null

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {visible.map((row) => (
        <div key={row.label} className={row.wide ? 'sm:col-span-2' : undefined}>
          <dt className="text-xs text-muted-foreground">{row.label}</dt>
          <dd className="mt-0.5 text-sm text-foreground [overflow-wrap:anywhere]">
            {row.links && row.links.length > 0 ? (
              <span className="flex flex-col gap-1">
                {row.links.map((link) =>
                  link.href ? (
                    <a
                      key={`${link.text}:${link.href}`}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      {link.text}
                    </a>
                  ) : (
                    <span key={link.text}>{link.text}</span>
                  )
                )}
              </span>
            ) : (
              row.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
