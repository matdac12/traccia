import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
