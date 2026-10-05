"use client";
import { RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** "Updated just now" / "Updated 40s ago", or a retry notice while polls fail. Clicking it polls now. */
export function LiveStatus({ lastUpdated, failures, onRefresh, className }: { lastUpdated: number | null; failures: number; onRefresh?: () => void; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  const seconds = lastUpdated === null ? null : Math.max(0, Math.round((now - lastUpdated) / 1000));
  const age = seconds === null ? "Live" : seconds < 10 ? "Updated just now" : seconds < 60 ? `Updated ${seconds}s ago` : `Updated ${Math.floor(seconds / 60)}m ago`;
  const failing = failures > 0;
  return (
    <button
      type="button"
      onClick={onRefresh}
      title="Refresh now"
      data-testid="live-status"
      className={cn("inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground", failing && "text-amber-600 dark:text-amber-400", className)}
    >
      {failing ? <WifiOff className="size-3" /> : <RefreshCw className="size-3" />}
      <span>{failing ? "Can't refresh, retrying" : age}</span>
    </button>
  );
}
