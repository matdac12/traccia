export function LabelChip({ name, color, compact = false }: { name: string; color: string; compact?: boolean }) {
  return (
    <span className={`inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full text-[11px] text-muted-foreground ${compact ? "min-w-0 max-w-24 shrink bg-muted/60 px-1.5" : "shrink-0 border px-2"}`}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className={compact ? "truncate" : undefined}>{name}</span>
    </span>
  );
}
