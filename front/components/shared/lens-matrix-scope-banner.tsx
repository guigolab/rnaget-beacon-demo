import Link from 'next/link'

type LensMatrixScopeBannerProps = {
  matrixId: string
  clearHref: string
  noun?: 'features' | 'biosamples'
}

export function LensMatrixScopeBanner({
  matrixId,
  clearHref,
  noun = 'features',
}: LensMatrixScopeBannerProps) {
  return (
    <div
      className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
      role="status"
    >
      <span>
        Showing {noun} in <span className="font-mono text-xs">{matrixId}</span>
      </span>
      <Link href={clearHref} className="text-sm text-primary underline">
        Clear
      </Link>
    </div>
  )
}
