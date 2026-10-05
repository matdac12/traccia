"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { recordLocation } from "@/lib/in-app-history";

/** Renders nothing; feeds route changes (path and query) to the in-app history store the Back button reads. */
export function InAppHistoryTracker() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => recordLocation(query ? `${pathname}?${query}` : pathname), [pathname, query]);
  return null;
}
