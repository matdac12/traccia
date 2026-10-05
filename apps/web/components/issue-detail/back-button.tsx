"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** True when this tab holds an earlier entry of the app to go back to (false for a deep link or a new tab). */
function hasInAppHistory() {
  return (window as { navigation?: { canGoBack: boolean } }).navigation?.canGoBack === true;
}

/**
 * Returns to the view the issue was opened from (list, board, project page) through real browser history, so its
 * URL state (filters, group-by, board vs table) comes back with it. Without in-app history it is a plain link to
 * `fallbackHref`, which also keeps "open in new tab" working.
 */
export function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon-xs" className="text-muted-foreground">
          <Link
            href={fallbackHref}
            aria-label="Back"
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !hasInAppHistory()) return;
              e.preventDefault();
              router.back();
            }}
          >
            <ArrowLeft />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Back</TooltipContent>
    </Tooltip>
  );
}
