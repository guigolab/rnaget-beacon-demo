export function LoadingNote({ label = 'Loading…' }: { label?: string }) {
  return <p className="text-sm text-muted-foreground">{label}</p>
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {message || 'Cannot reach the beacon.'}
    </p>
  )
}
