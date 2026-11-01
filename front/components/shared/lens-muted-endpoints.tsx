export function LensMutedEndpoints({ lines }: { lines: string[] }) {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground/80">
      {lines.join(' · ')}
    </p>
  )
}
