"use client";

import { Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StatusIcon } from "@/components/traccia/atoms";
import { Input } from "@/components/ui/input";
import { searchIssuesAction } from "@/app/(app)/issues/[identifier]/actions";
import type { IssueRef } from "@/lib/api/schemas";

/**
 * Type an identifier (`MAT-12`) or words from a title, pick an issue. Reusable for blockers and
 * parents. Results already in `exclude` are hidden.
 */
export function IssuePicker({
  onPick,
  exclude = [],
  placeholder = "Search by identifier or title…",
  autoFocus,
}: {
  onPick: (issue: IssueRef) => void;
  exclude?: readonly string[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<IssueRef[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const latest = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults([]);
      setState("idle");
      return;
    }
    const ticket = ++latest.current;
    setState("loading");
    const t = setTimeout(async () => {
      const res = await searchIssuesAction(query);
      if (ticket !== latest.current) return; // a newer keystroke superseded this lookup
      if (res.ok) {
        setResults(res.issues);
        setState("idle");
      } else setState("error");
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const shown = results.filter((r) => !exclude.includes(r.identifier));
  return (
    <div className="rounded-lg border bg-popover p-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} aria-label="Search issues" className="h-7 pl-7 text-[13px] md:text-[13px]" />
        {state === "loading" && <Loader2 className="absolute right-2 top-2 size-3.5 animate-spin text-muted-foreground" />}
      </div>
      {state === "error" && <p className="px-2 py-1.5 text-xs text-destructive">Search failed. Try again.</p>}
      {q.trim() && state === "idle" && shown.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No matching issues. Search matches whole words; an identifier like MAT-12 always works.</p>}
      {shown.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-y-auto">
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick(r)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-accent">
                <StatusIcon status={r.status} />
                <span className="font-mono text-xs text-muted-foreground">{r.identifier}</span>
                <span className="truncate">{r.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
