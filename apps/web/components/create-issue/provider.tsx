"use client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { shortcutBlocked } from "@/lib/is-typing";
import { CreateIssueDialog, type CreateIssueDefaults, type CreateIssueProject } from "./create-issue-dialog";

type Ctx = { open: (defaults?: CreateIssueDefaults) => void };
const CreateIssueContext = createContext<Ctx | null>(null);

/** Opens the create-issue dialog from anywhere below it: `useCreateIssue().open({ projectId })`. Also binds the `C` shortcut. */
export function useCreateIssue(): Ctx {
  const ctx = useContext(CreateIssueContext);
  if (!ctx) throw new Error("useCreateIssue must be used inside <CreateIssueProvider>");
  return ctx;
}

/** Like `useCreateIssue`, but null outside the provider (so embedded views can hide their "new issue" buttons). */
export function useOptionalCreateIssue(): Ctx | null {
  return useContext(CreateIssueContext);
}


export function CreateIssueProvider({ projects, children }: { projects: CreateIssueProject[]; children: ReactNode }) {
  const router = useRouter();
  const [isOpen, setOpen] = useState(false);
  const [defaults, setDefaults] = useState<CreateIssueDefaults | undefined>();
  const open = useCallback((d?: CreateIssueDefaults) => {
    setDefaults(d);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "c" || e.metaKey || e.ctrlKey || e.altKey || shortcutBlocked(e)) return;
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const value = useMemo(() => ({ open }), [open]);
  return (
    <CreateIssueContext.Provider value={value}>
      {children}
      <CreateIssueDialog open={isOpen} onOpenChange={setOpen} projects={projects} defaults={defaults} onCreated={() => router.refresh()} />
    </CreateIssueContext.Provider>
  );
}
