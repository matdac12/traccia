"use client";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/traccia/empty-state";

/**
 * Error boundary for everything inside the shell. Server-component errors arrive with a
 * redacted message in production (only `digest`), so this shows a generic text.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState icon={TriangleAlert} title="Something went wrong">
      The dashboard could not load this page. Check that the API is running, then try again.
      {error.digest ? <span className="mt-1 block font-mono text-[11px] opacity-70">ref {error.digest}</span> : null}
      <span className="mt-3 block">
        <Button size="sm" variant="outline" onClick={reset}>Try again</Button>
      </span>
    </EmptyState>
  );
}
