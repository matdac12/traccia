export function LabelChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[11px] text-muted-foreground">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}
