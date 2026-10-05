import { Skeleton } from "@/components/ui/skeleton";

const ROWS = Array.from({ length: 8 }, (_, i) => `skeleton-row-${i}`);

export default function Loading() {
  return (
    <div className="space-y-3 p-4" role="status" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-5 w-40" />
      {ROWS.map((row) => (
        <Skeleton key={row} className="h-9 w-full" />
      ))}
    </div>
  );
}
