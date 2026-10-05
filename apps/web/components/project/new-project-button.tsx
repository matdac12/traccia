"use client";
import { PROJECT_STATUSES, type ProjectStatus } from "@traccia/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { createProjectAction } from "@/app/(app)/projects/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** Opens the "New project" dialog. `children` is the trigger's content; `className`/`variant` style the trigger. */
export function NewProjectButton({ children, className, variant, size = "sm" }: { children: ReactNode; className?: string; variant?: "default" | "ghost"; size?: "sm" | "icon" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)}>{children}</Button>
      <NewProjectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setStatus("active");
    setError(null);
    setFieldErrors({});
  }, [open]);

  function submit() {
    if (pending) return;
    startTransition(async () => {
      setError(null);
      setFieldErrors({});
      const res = await createProjectAction({ name, description, status }).catch(() => null);
      if (!res) setError("Something went wrong. Check whether the project was created before retrying.");
      else if (res.ok) {
        onOpenChange(false);
        router.push(`/projects/${res.data.id}`);
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-lg"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      >
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="text-sm font-medium">New project</DialogTitle>
          <DialogDescription className="sr-only">Create a project</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 px-4 pb-3 pt-2">
          <Input
            autoFocus
            aria-label="Name"
            aria-invalid={fieldErrors.name ? true : undefined}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            className="h-9 border-0 px-0 text-base font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          {fieldErrors.name ? <p className="text-xs text-destructive">Name {fieldErrors.name}</p> : null}
          <Textarea
            aria-label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description… (markdown)"
            className="min-h-20 resize-none border-0 px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        </div>
        <div className="flex items-center gap-1.5 border-t px-4 py-2.5">
          <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
            <SelectTrigger size="sm" aria-label="Status" className="h-7 gap-1.5 text-xs capitalize"><SelectValue /></SelectTrigger>
            <SelectContent>{PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
          </Select>
          {fieldErrors.status ? <span className="text-xs text-destructive">Status {fieldErrors.status}</span> : null}
        </div>
        {error ? <p role="alert" className="border-t px-4 py-2 text-xs text-destructive">{error}</p> : null}
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={pending}>{pending ? "Creating…" : "Create project"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
